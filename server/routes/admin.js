const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { db, parseTaskDate, calculateDelayDays, determineStatus, parseDateComponents, computeTaskStatus } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Helper to save portrait (supports local disk or serverless Base64 fallback)
function savePortraitFile(file, leaderId = null) {
  if (!file || !file.buffer) return '';
  try {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'portraits');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.jpg';
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u0400-\u04FF]/g, '_');
    const filename = `${safeName}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(dir, filename), file.buffer);
    if (leaderId) {
      try {
        fs.writeFileSync(path.join(dir, `${leaderId}${ext}`), file.buffer);
      } catch (_) {}
    }
    return `/uploads/portraits/${filename}`;
  } catch (err) {
    // In serverless / read-only filesystem environments (e.g. Vercel), save as Base64 Data URL
    return `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`;
  }
}

// Strict Leader ID & Full Name photo matcher - NEVER matches on single words!
function findPhotoForLeader(leaderId, headName) {
  try {
    const portraitsDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'portraits');
    if (!fs.existsSync(portraitsDir)) return '';
    const availablePhotos = fs.readdirSync(portraitsDir);

    const cleanId = leaderId ? String(leaderId).trim().replace(/^#/, '') : '';

    // 1. Exact ID match (e.g. "101.jpg", "101.png", "101.webp", "101.jpeg")
    if (cleanId) {
      const exactIdMatch = availablePhotos.find(f => {
        const ext = path.extname(f).toLowerCase();
        const base = path.basename(f, ext);
        return base.toLowerCase() === cleanId.toLowerCase() &&
          ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext);
      });
      if (exactIdMatch) {
        return `/uploads/portraits/${exactIdMatch}`;
      }

      // 2. ID prefix match (e.g. "101_*.jpg", "101-*.jpg", "101 *.jpg")
      const prefixMatch = availablePhotos.find(f => {
        const ext = path.extname(f).toLowerCase();
        const base = path.basename(f, ext).toLowerCase();
        const cLower = cleanId.toLowerCase();
        return (base.startsWith(`${cLower}_`) || base.startsWith(`${cLower}-`) || base.startsWith(`${cLower} `)) &&
          ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext);
      });
      if (prefixMatch) {
        return `/uploads/portraits/${prefixMatch}`;
      }

      // 3. Existing department photo configured in database for this specific leaderId
      const existingDept = db.data.departments.find(d => String(d.leaderId) === cleanId);
      if (existingDept && existingDept.photo) {
        return existingDept.photo;
      }
    }

    // 4. Strict Full Name Match (All major words of full name must match filename)
    // NEVER match single words like "Alisher" or "Muzaffar" to avoid cross-person assignment!
    if (headName && headName.trim().length >= 6) {
      const normHead = headName.trim().toLowerCase().replace(/['`’‘]/g, '').replace(/\s+/g, ' ');
      const headWords = normHead.split(' ').filter(w => w.length >= 3);
      if (headWords.length >= 2) {
        const exactNameMatch = availablePhotos.find(f => {
          const ext = path.extname(f).toLowerCase();
          const base = path.basename(f, ext);
          if (/^\d+$/.test(base)) return false; // Ignore numeric ID files
          const normF = base.toLowerCase().replace(/['`’‘]/g, '').replace(/\s+/g, ' ');
          return headWords.every(hw => normF.includes(hw));
        });
        if (exactNameMatch) {
          return `/uploads/portraits/${exactNameMatch}`;
        }
      }
    }

    return '';
  } catch (err) {
    console.error('Error finding photo for leader:', err.message);
    return '';
  }
}

// Multer in-memory storage for photos
const uploadPortrait = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Faqat rasm fayllari (JPG, PNG, WEBP) qabul qilinadi.'));
    }
  }
});

const handlePortraitUpload = (req, res, next) => {
  uploadPortrait.single('photo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Rasm yuklashda xatolik: ' + err.message });
    }
    next();
  });
};

// Multer in-memory storage for Excel files (no disk writes, serverless friendly)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

const handleExcelUpload = (req, res, next) => {
  uploadExcel.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Excel faylini yuklashda xatolik: ' + err.message });
    }
    next();
  });
};

// Protect all admin routes
router.use(authenticate, requireAdmin);

// ==========================================
// 1. TASKS MANAGEMENT
// ==========================================

// GET /api/admin/tasks
router.get('/tasks', (req, res) => {
  const { status, departmentId, search, page = 1, pageSize = 25 } = req.query;

  db.syncTasksStatus(true);
  const now = new Date();

  let tasks = db.data.tasks.map(t => {
    const computed = computeTaskStatus(t, now);
    return { ...t, computedStatus: computed.status, delayDays: computed.delayDays };
  });

  if (status && status !== 'all') {
    tasks = tasks.filter(t => t.computedStatus === status);
  }
  if (departmentId && departmentId !== 'all') {
    tasks = tasks.filter(t => t.departmentId === departmentId);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    tasks = tasks.filter(t =>
      (t.taskNumber && t.taskNumber.toLowerCase().includes(q)) ||
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.docNumberAndDate && t.docNumberAndDate.toLowerCase().includes(q)) ||
      (t.responsiblePerson && t.responsiblePerson.toLowerCase().includes(q)) ||
      (t.departmentName && t.departmentName.toLowerCase().includes(q))
    );
  }

  tasks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const total = tasks.length;
  const p = Math.max(1, parseInt(page) || 1);
  const limit = Math.max(1, parseInt(pageSize) || 25);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startIndex = (p - 1) * limit;
  const items = tasks.slice(startIndex, startIndex + limit);

  res.json({ items, total, page: p, pageSize: limit, totalPages });
});

// POST /api/admin/tasks
router.post('/tasks', (req, res) => {
  try {
    const {
      taskNumber,
      docNumberAndDate,
      docType,
      taskType,
      title,
      departmentId,
      responsiblePerson,
      deadline,
      status = 'in_progress',
      notes = ''
    } = req.body;

    if (!title || !departmentId || !deadline) {
      return res.status(400).json({ error: 'Topshiriq mazmuni, mas’ul boshqarma va ijro muddati to‘ldirilishi shart.' });
    }

    const dept = db.data.departments.find(d => d.id === departmentId);
    if (!dept) {
      return res.status(400).json({ error: 'Tanlangan boshqarma topilmadi.' });
    }

    const parsedDeadline = parseTaskDate(deadline);
    const computedStatus = determineStatus(status, parsedDeadline);
    const delayDays = calculateDelayDays(parsedDeadline);

    const newTask = {
      id: crypto.randomUUID(),
      taskNumber: taskNumber || `№${db.data.tasks.length + 1}`,
      docNumberAndDate: docNumberAndDate || taskNumber || '',
      docType: docType || 'Hujjat',
      taskType: taskType || 'Ijro topshirig‘i',
      title: title.trim(),
      departmentId: dept.id,
      departmentName: dept.name,
      responsiblePerson: responsiblePerson ? responsiblePerson.trim() : dept.headName,
      deadline: parsedDeadline,
      status: computedStatus,
      completedDate: computedStatus === 'completed' ? new Date().toISOString() : null,
      delayDays: computedStatus === 'overdue' ? delayDays : 0,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.data.tasks.unshift(newTask);
    db.save();

    res.json({ success: true, task: newTask, message: 'Topshiriq muvaffaqiyatli yaratildi.' });
  } catch (err) {
    res.status(500).json({ error: 'Topshiriqni yaratishda xatolik: ' + err.message });
  }
});

// PUT /api/admin/tasks/:id
router.put('/tasks/:id', (req, res) => {
  try {
    const taskIndex = db.data.tasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Topshiriq topilmadi.' });
    }

    const currentTask = db.data.tasks[taskIndex];
    const {
      taskNumber,
      docNumberAndDate,
      docType,
      taskType,
      title,
      departmentId,
      responsiblePerson,
      deadline,
      status,
      notes
    } = req.body;

    let dept = currentTask.departmentId ? db.data.departments.find(d => d.id === (departmentId || currentTask.departmentId)) : null;
    const parsedDeadline = deadline ? parseTaskDate(deadline) : currentTask.deadline;
    const computedStatus = status ? determineStatus(status, parsedDeadline) : currentTask.status;
    const delayDays = calculateDelayDays(parsedDeadline);

    db.data.tasks[taskIndex] = {
      ...currentTask,
      taskNumber: taskNumber !== undefined ? taskNumber : currentTask.taskNumber,
      docNumberAndDate: docNumberAndDate !== undefined ? docNumberAndDate : currentTask.docNumberAndDate,
      docType: docType !== undefined ? docType : currentTask.docType,
      taskType: taskType !== undefined ? taskType : currentTask.taskType,
      title: title !== undefined ? title.trim() : currentTask.title,
      departmentId: dept ? dept.id : currentTask.departmentId,
      departmentName: dept ? dept.name : currentTask.departmentName,
      responsiblePerson: responsiblePerson !== undefined ? responsiblePerson.trim() : currentTask.responsiblePerson,
      deadline: parsedDeadline,
      status: computedStatus,
      completedDate: computedStatus === 'completed' ? (currentTask.completedDate || new Date().toISOString()) : null,
      delayDays: computedStatus === 'overdue' ? delayDays : 0,
      notes: notes !== undefined ? notes.trim() : currentTask.notes,
      updatedAt: new Date().toISOString()
    };

    db.save();
    res.json({ success: true, task: db.data.tasks[taskIndex], message: 'Topshiriq muvaffaqiyatli yangilandi.' });
  } catch (err) {
    res.status(500).json({ error: 'Topshiriqni yangilashda xatolik: ' + err.message });
  }
});

// DELETE /api/admin/tasks/:id
router.delete('/tasks/:id', (req, res) => {
  const index = db.data.tasks.findIndex(t => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
  db.data.tasks.splice(index, 1);
  db.save();
  res.json({ success: true, message: 'Topshiriq o‘chirildi.' });
});

// POST /api/admin/tasks/bulk-delete
router.post('/tasks/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'O‘chirish uchun topshiriqlar tanlanmadi.' });
  }
  const idSet = new Set(ids);
  db.data.tasks = db.data.tasks.filter(t => !idSet.has(t.id));
  db.save();
  res.json({ success: true, message: `${ids.length} ta topshiriq o‘chirildi.` });
});

// ==========================================
// 2. EXCEL IMPORT & EXPORT
// ==========================================

// POST /api/admin/tasks/import-excel
router.post('/tasks/import-excel', handleExcelUpload, (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Excel fayli yuklanmadi.' });
  }

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return res.status(400).json({ error: 'Excel faylida varaqlar (sheet) topilmadi.' });
    }

    // 1. Pick the best sheet: look for sheets containing tasks keywords, or pick the one with most rows
    let selectedSheetName = wb.SheetNames[0];
    const preferredSheet = wb.SheetNames.find(s => {
      const lower = s.toLowerCase();
      return lower.includes('топшириқ') || lower.includes('topshiriq') || lower.includes('ijro') || lower.includes('jadval');
    });
    if (preferredSheet) {
      selectedSheetName = preferredSheet;
    } else {
      // Find sheet with the largest data range
      let maxRows = 0;
      for (const sName of wb.SheetNames) {
        const s = wb.Sheets[sName];
        if (s && s['!ref']) {
          const range = XLSX.utils.decode_range(s['!ref']);
          const rowCount = range.e.r - range.s.r + 1;
          if (rowCount > maxRows) {
            maxRows = rowCount;
            selectedSheetName = sName;
          }
        }
      }
    }

    const sheet = wb.Sheets[selectedSheetName];
    if (!sheet || !sheet['!ref']) {
      return res.status(400).json({ error: 'Tanlangan varaq bo‘sh yoki yaroqsiz.' });
    }

    // 2. Read sheet as 2D array of rows to locate the real header row
    const rawMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawMatrix || rawMatrix.length === 0) {
      return res.status(400).json({ error: 'Excel faylida ma’lumot topilmadi.' });
    }

    const headerKeywords = [
      'topshiriq', 'топшириқ', 'boshqarma', 'бошқарма', 'ijro', 'ижро',
      'muddat', 'муддат', 'rahbar', 'раҳбар', 'hujjat', 'ҳужжат', 't/r', '№',
      'id', 'fish', 'фиш', 'masul', 'mas’ul', 'mas\'ul', 'масъул', 'xodim', 'ходим', 'hodim'
    ];

    let headerRowIndex = 0;
    let maxKeywordMatches = 0;

    for (let r = 0; r < Math.min(rawMatrix.length, 15); r++) {
      const row = rawMatrix[r];
      if (!Array.isArray(row)) continue;
      const joined = row.map(cell => String(cell || '').toLowerCase()).join(' ');
      let matches = 0;
      for (const kw of headerKeywords) {
        if (joined.includes(kw)) matches++;
      }
      if (matches > maxKeywordMatches && matches >= 2) {
        maxKeywordMatches = matches;
        headerRowIndex = r;
      }
    }

    // Parse rows using the detected header row
    const rawRows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '' });
    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ error: 'Excel faylidan topshiriqlar qatorlari topilmadi.' });
    }

    // Helper to get normalized value by flexible column aliases
    function getColValue(row, aliases) {
      const rowKeys = Object.keys(row);
      for (const alias of aliases) {
        const normAlias = alias.toLowerCase().replace(/['`’‘]/g, '').trim();
        const foundKey = rowKeys.find(k => {
          const normKey = k.toLowerCase().replace(/['`’‘]/g, '').trim();
          return normKey === normAlias;
        });
        if (foundKey && String(row[foundKey]).trim() !== '') {
          return String(row[foundKey]).trim();
        }
      }
      return '';
    }

    // Departments lookup maps
    const deptMapById = new Map();
    const deptMapByName = new Map();
    db.data.departments.forEach(d => {
      if (d.leaderId) deptMapById.set(String(d.leaderId).trim(), d);
      deptMapByName.set(d.name.toLowerCase().replace(/['`’‘]/g, '').trim(), d);
    });

    const newTasks = [];
    let addedDeptsCount = 0;

    rawRows.forEach((row, idx) => {
      // 1. Leader / Employee ID
      const rawLeaderId = getColValue(row, [
        'Rahbar ID', 'Rahbar ID raqami', 'Rahbar IDsi', 'Rahbar_ID', 'Leader ID', 'Leader_ID', 'LeaderID',
        'Mas’ul ID', 'Mas\'ul ID', 'Masul ID', 'Xodim ID', 'Hodim ID', 'Xodim ID raqami', 'Hodim ID raqami',
        'Tabel raqami', 'Tabel', 'ID raqam', 'ID raqami', 'Xodim_ID', 'Hodim_ID', 'ID'
      ]).replace(/^#/, '');

      // 2. Department name
      const deptName = getColValue(row, [
        'Mas’ul boshqarma', 'Mas\'ul boshqarma', 'Masul boshqarma', 'Boshqarma nomi', 'Boshqarma',
        'Bo‘lim', 'Bo\'lim', 'Bolim', 'Boshqarma / Bo‘lim', 'Tashkilot', 'Tarkibiy tuzilma', 'Lavozimi'
      ]);

      // 3. Responsible person / Head name
      const headName = getColValue(row, [
        'Mas’ul ijrochi', 'Mas\'ul ijrochi', 'Masul ijrochi', 'Mas’ul rahbar', 'Mas\'ul rahbar',
        'Mas’ul xodim', 'Mas\'ul xodim', 'Masul xodim', 'Ijrochi', 'Mas’ul', 'Mas\'ul', 'Masul',
        'Rahbar', 'Rahbar F.I.SH', 'F.I.SH.', 'F.I.SH', 'FISH', 'F.I.O.', 'F.I.O', 'FIO',
        'Xodim F.I.SH', 'Hodim F.I.SH', 'Xodim', 'Hodim'
      ]);

      // 4. Task title / content
      const title = getColValue(row, [
        'Topshiriq mazmuni', 'Topshiriq matni', 'Topshiriq', 'Mazmuni', 'Ijro mazmuni',
        'Hujjat raqami va sanasi', 'Hujjat raqami', 'Topshiriq qisqacha mazmuni'
      ]);

      // If all critical fields are empty, skip empty row
      if (!rawLeaderId && (!deptName || deptName === '-') && !headName && !title) return;

      // 5. Task Number / ID
      let taskNumber = getColValue(row, [
        'Topshiriq ID', 'Topshiriq raqami', 'Topshiriq №', '№', 'T/r', 'T/r.', 'T/r ', 'TR', 'Tartib raqam', 'Raqami'
      ]);
      if (!taskNumber) taskNumber = `№${idx + 1}`;

      // 6. Deadline
      const rawDate = getColValue(row, [
        'Ijro muddati', 'Topshiriq muddati', 'Muddati', 'Muddat', 'Belgilangan muddat',
        'Ijro sanasi', 'Sana', 'Yakunlash sanasi', 'Berilgan sana'
      ]);
      const deadline = parseTaskDate(rawDate) || new Date().toISOString().split('T')[0];

      // 7. Status
      const rawStatus = getColValue(row, ['Holati', 'Holat', 'Status', 'Ijro holati', 'Natija']);
      const initialStatus = determineStatus(rawStatus, deadline);
      const initialDelayDays = calculateDelayDays(deadline);

      const candidateTask = {
        deadline,
        status: initialStatus,
        delayDays: initialStatus === 'overdue' ? (initialDelayDays || 1) : 0,
        completedDate: initialStatus === 'completed' ? new Date().toISOString() : null
      };
      const computed = computeTaskStatus(candidateTask);

      // 8. Document & Task type, Notes
      const docType = getColValue(row, ['Hujjat turi', 'Turi', 'Hujjat']) || 'Hujjat';
      const taskType = getColValue(row, ['Topshiriq turi', 'Topshiriq yo‘nalishi', 'Topshiriq toifasi']) || 'Ijro topshirig‘i';
      const notes = getColValue(row, ['Izoh', 'Qayd', 'Izohlar', 'Eslatma']);

      // 9. Department and Leader Resolution - STRICTLY BY ID!
      let dept = null;

      if (rawLeaderId) {
        dept = deptMapById.get(rawLeaderId) || db.data.departments.find(d => String(d.leaderId) === rawLeaderId);
      }

      if (!dept && deptName && deptName !== '-') {
        const normDName = deptName.toLowerCase().replace(/['`’‘]/g, '').trim();
        dept = deptMapByName.get(normDName);
      }

      if (dept) {
        // Update department information from current Excel
        if (deptName && deptName !== '-' && (!dept.name || dept.name.startsWith('Boshqarma #') || dept.name !== deptName)) {
          dept.name = deptName;
          deptMapByName.set(dept.name.toLowerCase().replace(/['`’‘]/g, '').trim(), dept);
        }
        if (headName && (!dept.headName || dept.headName === 'Mas’ul rahbar' || dept.headName !== headName)) {
          dept.headName = headName;
        }
        // Strict photo check: strictly for this department's ID / full name
        const matchedPhoto = findPhotoForLeader(dept.leaderId, dept.headName);
        if (matchedPhoto) {
          dept.photo = matchedPhoto;
        }
      } else {
        // Auto-create department
        let autoLeaderId = rawLeaderId && /^\d+$/.test(rawLeaderId)
          ? parseInt(rawLeaderId, 10)
          : db.getNextLeaderId();

        const resolvedDeptName = deptName && deptName !== '-' ? deptName : `Boshqarma #${autoLeaderId}`;
        const resolvedHeadName = headName || 'Mas’ul rahbar';
        const matchedPhoto = findPhotoForLeader(autoLeaderId, resolvedHeadName);

        dept = {
          id: crypto.randomUUID(),
          leaderId: autoLeaderId,
          name: resolvedDeptName,
          headName: resolvedHeadName,
          headTitle: 'Mas’ul rahbar',
          photo: matchedPhoto,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.data.departments.push(dept);
        deptMapById.set(String(dept.leaderId), dept);
        deptMapByName.set(dept.name.toLowerCase().replace(/['`’‘]/g, '').trim(), dept);
        addedDeptsCount++;
      }

      // Add to newTasks list
      newTasks.push({
        id: crypto.randomUUID(),
        taskNumber,
        leaderId: dept.leaderId,
        docNumberAndDate: title || taskNumber,
        docType,
        taskType,
        title: title || `Topshiriq #${idx + 1}`,
        departmentId: dept.id,
        departmentName: dept.name,
        responsiblePerson: headName || dept.headName,
        deadline,
        status: computed.status,
        completedDate: computed.status === 'completed' ? new Date().toISOString() : null,
        delayDays: computed.delayDays,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    if (newTasks.length === 0) {
      return res.status(400).json({ error: 'Excel faylidan birorta ham topshiriq o‘qib bo‘lmadi. Ustunlar nomini tekshiring.' });
    }

    // MANDATORY REQUIREMENT 1:
    // Completely wipe old tasks and replace with ONLY the new import!
    db.data.tasks = newTasks;

    // Recalculate all task statuses according to deadlines
    db.syncTasksStatus(true);
    db.save();

    res.json({
      success: true,
      importedCount: newTasks.length,
      addedDeptsCount,
      totalTasks: db.data.tasks.length,
      message: `Muvaffaqiyatli import qilindi: ${newTasks.length} ta topshiriq. Eski ma’lumotlar avtomatik tozalandi.`
    });
  } catch (err) {
    console.error('Import excel error:', err);
    res.status(500).json({ error: 'Excel faylini import qilishda xatolik: ' + err.message });
  }
});

// GET /api/admin/tasks/export-excel
router.get('/tasks/export-excel', (req, res) => {
  try {
    const rows = db.data.tasks.map((t, idx) => {
      const dept = db.data.departments.find(d => d.id === t.departmentId);
      return {
        '№': idx + 1,
        'Topshiriq ID': t.taskNumber,
        'Rahbar ID': dept ? (dept.leaderId || '') : (t.leaderId || ''),
        'Topshiriq turi': t.taskType || 'Ijro topshirig‘i',
        'Hujjat turi': t.docType || 'Hujjat',
        'Topshiriq mazmuni': t.title,
        'Mas’ul boshqarma': t.departmentName,
        'Mas’ul ijrochi': t.responsiblePerson,
        'Ijro muddati': t.deadline,
        'Holati': t.status === 'completed' ? 'Bajarilgan' : (t.status === 'overdue' ? 'Muddati o‘tgan' : 'Bajarish jarayonida'),
        'Kechikish kunlari': t.delayDays || 0,
        'Izoh': t.notes || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Topshiriqlar');

    // Also append Leader Reference Sheet to Export
    const directoryRows = db.data.departments.map(d => ({
      'Rahbar ID': d.leaderId,
      'Mas’ul rahbar (F.I.SH.)': d.headName,
      'Boshqarma nomi': d.name,
      'Lavozimi': d.headTitle || 'Mas’ul rahbar'
    }));
    const wsDirectory = XLSX.utils.json_to_sheet(directoryRows);
    XLSX.utils.book_append_sheet(wb, wsDirectory, 'Rahbarlar ID ma\'lumotnomasi');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="ijro_topshiriqlar_eksport.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Eksport qilishda xatolik: ' + err.message });
  }
});

// GET /api/admin/tasks/template-excel
router.get('/tasks/template-excel', (req, res) => {
  try {
    const sampleRows = [
      {
        'Topshiriq ID': '№1',
        'Rahbar ID': 101,
        'Mas’ul boshqarma': 'Xodimlar bilan ishlash boshqarmasi',
        'Mas’ul ijrochi': "TURG'UNOVA FERUZA ABDURAHIMOVNA",
        'Topshiriq turi': 'Prezident topshiriqlari',
        'Hujjat turi': 'Qaror',
        'Topshiriq mazmuni': 'PQ-163-sonli qaror ijrosini ta\'minlash',
        'Ijro muddati': '2026-11-20',
        'Holati': 'Bajarish jarayonida',
        'Izoh': 'Nazorat ostida'
      },
      {
        'Topshiriq ID': '№2',
        'Rahbar ID': 102,
        'Mas’ul boshqarma': 'Xalqaro aloqalar va investitsiyalarni jalb qilish boshqarmasi',
        'Mas’ul ijrochi': 'DJURAYEV ALISHER MIRZAMAHKAMOVICH',
        'Topshiriq turi': 'Hukumat komissiyasi topshiriqlari',
        'Hujjat turi': 'Bayon',
        'Topshiriq mazmuni': 'Investitsiya loyihalari bo\'yicha hisobot tayyorlash',
        'Ijro muddati': '2026-09-30',
        'Holati': 'Muddati o‘tgan',
        'Izoh': 'Kechikkan topshiriq'
      },
      {
        'Topshiriq ID': '№3',
        'Rahbar ID': 121,
        'Mas’ul boshqarma': 'Mustahkamlik va xavfsizlik texnikasi bo‘limi',
        'Mas’ul ijrochi': 'UMIROV BAXROMJON MAMATALIYEVICH',
        'Topshiriq turi': 'Vazirlar Mahkamasi topshiriqlari',
        'Hujjat turi': 'Topshiriq',
        'Topshiriq mazmuni': 'Texnika xavfsizligi bo\'yicha profilaktika chora-tadbirlari',
        'Ijro muddati': '2026-10-15',
        'Holati': 'Muddati o‘tgan',
        'Izoh': 'Nazoratda'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);

    // Sheet 2: Rahbarlar ID ma'lumotnomasi
    const directoryRows = db.data.departments.map(d => ({
      'Rahbar ID': d.leaderId,
      'Mas’ul rahbar (F.I.SH.)': d.headName,
      'Boshqarma nomi': d.name,
      'Lavozimi': d.headTitle || 'Mas’ul rahbar',
      'Fotosurat holati': d.photo ? 'Mavjud (Yuklangan)' : 'Mavjud emas'
    }));
    const wsDirectory = XLSX.utils.json_to_sheet(directoryRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Topshiriqlar shabloni');
    XLSX.utils.book_append_sheet(wb, wsDirectory, 'Rahbarlar ID ma\'lumotnomasi');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="ijro_standart_shablon.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Shablon yaratishda xatolik: ' + err.message });
  }
});

// ==========================================
// 3. DEPARTMENTS & HEADS MANAGEMENT
// ==========================================

// GET /api/admin/departments/next-id
router.get('/departments/next-id', (req, res) => {
  res.json({ nextId: db.getNextLeaderId() });
});

// GET /api/admin/departments
router.get('/departments', (req, res) => {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const list = db.data.departments.map(d => {
    let overdueCount = 0;
    let totalTasks = 0;

    db.data.tasks.forEach(t => {
      if (t.departmentId === d.id) {
        totalTasks++;
        let status = t.status;
        if (status !== 'completed' && t.deadline) {
          const dMidnight = parseDateComponents(t.deadline);
          if (dMidnight) {
            if (todayMidnight > dMidnight) {
              status = 'overdue';
            } else {
              status = 'in_progress';
            }
          }
        }
        if (status === 'overdue') overdueCount++;
      }
    });

    return {
      ...d,
      overdueCount,
      totalTasks
    };
  });

  // Sort by overdueCount desc, then leaderId asc
  list.sort((a, b) => {
    if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
    return (parseInt(a.leaderId) || 0) - (parseInt(b.leaderId) || 0);
  });
  res.json(list);
});

// POST /api/admin/departments (supports portrait photo upload and auto/manual leaderId)
router.post('/departments', handlePortraitUpload, (req, res) => {
  try {
    const { name, headName, headTitle = 'Mas’ul rahbar', leaderId, status = 'active' } = req.body;
    if (!name || !headName) {
      return res.status(400).json({ error: 'Boshqarma nomi va rahbar ismi kiritilishi shart.' });
    }

    let assignedLeaderId = parseInt(leaderId, 10);
    if (isNaN(assignedLeaderId) || assignedLeaderId <= 0) {
      assignedLeaderId = db.getNextLeaderId();
    }

    let photoUrl = '';
    if (req.file) {
      photoUrl = savePortraitFile(req.file, assignedLeaderId);
    }

    const newDept = {
      id: crypto.randomUUID(),
      leaderId: assignedLeaderId,
      name: name.trim(),
      headName: headName.trim(),
      headTitle: headTitle.trim() || 'Mas’ul rahbar',
      photo: photoUrl,
      status: status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.data.departments.push(newDept);
    db.save();

    res.json({ success: true, department: newDept, message: `Boshqarma va rahbar (#${assignedLeaderId}) muvaffaqiyatli yaratildi.` });
  } catch (err) {
    res.status(500).json({ error: 'Boshqarma yaratishda xatolik: ' + err.message });
  }
});

// PUT /api/admin/departments/:id
router.put('/departments/:id', handlePortraitUpload, (req, res) => {
  try {
    const index = db.data.departments.findIndex(d => d.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Boshqarma topilmadi.' });

    const currentDept = db.data.departments[index];
    const { name, headName, headTitle, leaderId, status, deletePhoto } = req.body;

    let updatedLeaderId = currentDept.leaderId;
    if (leaderId !== undefined && String(leaderId).trim() !== '') {
      const parsed = parseInt(leaderId, 10);
      if (!isNaN(parsed) && parsed > 0) updatedLeaderId = parsed;
    }

    let photoUrl = currentDept.photo;
    if (deletePhoto === 'true' || deletePhoto === true || deletePhoto === '1') {
      photoUrl = '';
    }
    if (req.file) {
      photoUrl = savePortraitFile(req.file, updatedLeaderId);
    }

    const updatedDept = {
      ...currentDept,
      leaderId: updatedLeaderId,
      name: name !== undefined ? name.trim() : currentDept.name,
      headName: headName !== undefined ? headName.trim() : currentDept.headName,
      headTitle: headTitle !== undefined ? headTitle.trim() : currentDept.headTitle,
      photo: photoUrl,
      status: status !== undefined ? status : currentDept.status,
      updatedAt: new Date().toISOString()
    };

    db.data.departments[index] = updatedDept;

    // Update departmentName, responsiblePerson, and leaderId in all linked tasks
    db.data.tasks.forEach(t => {
      if (t.departmentId === currentDept.id) {
        if (updatedDept.name) t.departmentName = updatedDept.name;
        if (updatedDept.headName) t.responsiblePerson = updatedDept.headName;
        t.leaderId = updatedLeaderId;
      }
    });

    db.save();
    res.json({ success: true, department: updatedDept, message: 'Boshqarma muvaffaqiyatli yangilandi.' });
  } catch (err) {
    res.status(500).json({ error: 'Boshqarma yangilashda xatolik: ' + err.message });
  }
});

// DELETE /api/admin/departments/:id
router.delete('/departments/:id', (req, res) => {
  const index = db.data.departments.findIndex(d => d.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Boshqarma topilmadi.' });

  const hasTasks = db.data.tasks.some(t => t.departmentId === req.params.id);
  if (hasTasks) {
    return res.status(400).json({ error: 'Ushbu boshqarmaga biriktirilgan topshiriqlar mavjud. Avval ularni ko‘chiring yoki o‘chiring.' });
  }

  db.data.departments.splice(index, 1);
  db.save();
  res.json({ success: true, message: 'Boshqarma o‘chirildi.' });
});

// ==========================================
// 4. USERS MANAGEMENT
// ==========================================

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.data.users.map(u => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt
  }));
  res.json(users);
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  try {
    const { username, password, fullName, role = 'viewer' } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'Foydalanuvchi nomi, parol va F.I.SH. to‘ldirilishi shart.' });
    }

    const exists = db.data.users.some(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (exists) {
      return res.status(400).json({ error: 'Bunday loginli foydalanuvchi allaqachon mavjud.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newUser = {
      id: crypto.randomUUID(),
      username: username.trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(password, salt),
      fullName: fullName.trim(),
      role: role === 'admin' ? 'admin' : 'viewer',
      createdAt: new Date().toISOString()
    };

    db.data.users.push(newUser);
    db.save();

    res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        fullName: newUser.fullName,
        role: newUser.role,
        createdAt: newUser.createdAt
      },
      message: 'Foydalanuvchi muvaffaqiyatli qo‘shildi.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Foydalanuvchini qo‘shishda xatolik: ' + err.message });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  try {
    const index = db.data.users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

    const currentUser = db.data.users[index];
    const { username, password, fullName, role } = req.body;

    if (username && username.trim().toLowerCase() !== currentUser.username) {
      const exists = db.data.users.some(u => u.id !== currentUser.id && u.username.toLowerCase() === username.trim().toLowerCase());
      if (exists) return res.status(400).json({ error: 'Bu foydalanuvchi nomi band.' });
      currentUser.username = username.trim().toLowerCase();
    }

    if (fullName) currentUser.fullName = fullName.trim();
    if (role && (role === 'admin' || role === 'viewer')) currentUser.role = role;

    if (password && password.trim()) {
      const salt = bcrypt.genSaltSync(10);
      currentUser.passwordHash = bcrypt.hashSync(password.trim(), salt);
    }

    db.save();
    res.json({
      success: true,
      user: {
        id: currentUser.id,
        username: currentUser.username,
        fullName: currentUser.fullName,
        role: currentUser.role
      },
      message: 'Foydalanuvchi ma’lumotlari yangilandi.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Foydalanuvchini yangilashda xatolik: ' + err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (req.user && req.user.id === req.params.id) {
    return res.status(400).json({ error: 'O‘z hisobingizni o‘chira olmaysiz.' });
  }
  const index = db.data.users.findIndex(u => u.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
  db.data.users.splice(index, 1);
  db.save();
  res.json({ success: true, message: 'Foydalanuvchi o‘chirildi.' });
});

// ==========================================
// 5. SETTINGS MANAGEMENT
// ==========================================

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  res.json(db.data.settings);
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const { orgName, subOrgName, systemTitle, autoRefreshInterval } = req.body;
  if (orgName) db.data.settings.orgName = orgName.trim();
  if (subOrgName) db.data.settings.subOrgName = subOrgName.trim();
  if (systemTitle) db.data.settings.systemTitle = systemTitle.trim();
  if (autoRefreshInterval) db.data.settings.autoRefreshInterval = parseInt(autoRefreshInterval) || 60;

  db.save();
  res.json({ success: true, settings: db.data.settings, message: 'Sozlamalar saqlandi.' });
});

module.exports = router;
