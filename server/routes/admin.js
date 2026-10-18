const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { db, parseTaskDate, calculateDelayDays, determineStatus, parseDateComponents } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Multer storage for photos
const portraitsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'portraits');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u0400-\u04FF]/g, '_');
    cb(null, `${safeName}_${Date.now()}${ext}`);
  }
});

const uploadPortrait = multer({
  storage: portraitsStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Faqat rasm fayllari (JPG, PNG, WEBP) qabul qilinadi.'));
    }
  }
});

// Multer storage for Excel files
const excelStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'excels');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `import_${Date.now()}${ext}`);
  }
});

const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Protect all admin routes
router.use(authenticate, requireAdmin);

// ==========================================
// 1. TASKS MANAGEMENT
// ==========================================

// GET /api/admin/tasks
router.get('/tasks', (req, res) => {
  const { status, departmentId, search, page = 1, pageSize = 25 } = req.query;

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let tasks = db.data.tasks.map(t => {
    let computedStatus = t.status;
    let delayDays = t.delayDays || 0;

    if (computedStatus !== 'completed' && t.deadline) {
      const dMidnight = parseDateComponents(t.deadline);
      if (dMidnight) {
        if (todayMidnight > dMidnight) {
          computedStatus = 'overdue';
          delayDays = calculateDelayDays(t.deadline);
        } else {
          computedStatus = 'in_progress';
          delayDays = 0;
        }
      }
    }

    return { ...t, computedStatus, delayDays };
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
router.post('/tasks/import-excel', uploadExcel.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Excel fayli yuklanmadi.' });
  }

  try {
    const importMode = req.body.mode || 'append'; // 'replace' or 'append'
    const filePath = req.file.path;
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ error: 'Excel faylida ma’lumot topilmadi.' });
    }

    const availablePhotos = fs.existsSync(path.join(__dirname, '..', '..', 'public', 'uploads', 'portraits'))
      ? fs.readdirSync(path.join(__dirname, '..', '..', 'public', 'uploads', 'portraits'))
      : [];

    // Ensure departments
    const deptMapByName = new Map();
    db.data.departments.forEach(d => {
      deptMapByName.set(d.name.toLowerCase().replace(/['`’]/g, ''), d);
    });

    const newTasks = [];
    let addedDeptsCount = 0;

    rawRows.forEach((row, idx) => {
      // 1. Flexible column keys for Leader/Department ID
      const rawLeaderId = String(
        row['Rahbar ID'] ||
        row['Rahbar ID raqami'] ||
        row['Mas’ul ID'] ||
        row['Mas\'ul ID'] ||
        row['Boshqarma ID'] ||
        row['Xodim ID'] ||
        row['Hodim ID'] ||
        row['Tabel raqami'] ||
        row['ID raqam'] ||
        row['ID'] ||
        ''
      ).trim().replace(/^#/, '');

      const deptName = String(
        row['Mas’ul boshqarma'] ||
        row['Mas\'ul boshqarma'] ||
        row['Lavozimi'] ||
        row['Boshqarma'] ||
        ''
      ).trim();

      const headName = String(
        row['Mas’ul ijrochi'] ||
        row['Mas\'ul ijrochi'] ||
        row['Ma\'sul xodim'] ||
        row['Ijrochi'] ||
        ''
      ).trim();

      // If all critical fields are empty, skip row
      if (!rawLeaderId && (!deptName || deptName === '-') && !headName) return;

      let dept = null;

      // Match Strategy 1: Find by explicit leaderId (or id)
      if (rawLeaderId) {
        dept = db.data.departments.find(d => 
          String(d.leaderId) === rawLeaderId || 
          String(d.id) === rawLeaderId ||
          (d.leaderId && String(d.leaderId).toLowerCase() === rawLeaderId.toLowerCase())
        );
        // Also support 1-based index (e.g. 1 -> 101)
        if (!dept && /^\d+$/.test(rawLeaderId)) {
          const num = parseInt(rawLeaderId, 10);
          if (num < 100) {
            dept = db.data.departments.find(d => String(d.leaderId) === String(num + 100));
          }
        }
      }

      // Match Strategy 2: If no ID found, check if deptName or headName begins with numeric ID
      if (!dept && deptName) {
        const numMatch = deptName.match(/^#?(\d+)/);
        if (numMatch) {
          const extractedId = numMatch[1];
          dept = db.data.departments.find(d => 
            String(d.leaderId) === extractedId || 
            String(d.leaderId) === String(parseInt(extractedId, 10) + 100)
          );
        }
      }

      // Match Strategy 3: Match by Department Name
      if (!dept && deptName) {
        const deptKey = deptName.toLowerCase().replace(/['`’]/g, '');
        dept = deptMapByName.get(deptKey);
      }

      // Match Strategy 4: Match by Head Name
      if (!dept && headName) {
        const normHead = headName.toLowerCase().replace(/['`’]/g, '');
        dept = db.data.departments.find(d => d.headName && d.headName.toLowerCase().replace(/['`’]/g, '') === normHead);
      }

      // Strategy 5: If not found, auto-create department with new leaderId!
      if (!dept) {
        let matchedPhoto = '';
        if (headName) {
          const normHead = headName.toLowerCase().replace(/['`’]/g, '');
          const headParts = normHead.split(/\s+/).filter(p => p.length >= 4);
          const found = availablePhotos.find(f => {
            const normF = f.toLowerCase().replace(/['`’]/g, '');
            return headParts.some(hp => normF.includes(hp));
          });
          if (found) matchedPhoto = `/uploads/portraits/${found}`;
        }

        const autoLeaderId = rawLeaderId && /^\d+$/.test(rawLeaderId)
          ? parseInt(rawLeaderId, 10)
          : db.getNextLeaderId();

        const resolvedDeptName = deptName && deptName !== '-' ? deptName : `Boshqarma #${autoLeaderId}`;
        const resolvedHeadName = headName || 'Mas’ul rahbar';

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
        deptMapByName.set(dept.name.toLowerCase().replace(/['`’]/g, ''), dept);
        addedDeptsCount++;
      }

      const rawDate = row['Ijro muddati'] || row['Topshiriq muddati'] || row['Muddati'];
      const deadline = parseTaskDate(rawDate);
      const rawStatus = row['Holati'] || '';
      const status = determineStatus(rawStatus, deadline);
      const delayDays = calculateDelayDays(deadline);

      const title = String(
        row['Topshiriq mazmuni'] ||
        row['Hujjat raqami va sanasi'] ||
        row['Mazmuni'] ||
        row['Topshiriq'] ||
        `Topshiriq #${idx + 1}`
      ).trim();

      const taskNumber = String(
        row['Topshiriq ID'] ||
        row['№'] ||
        row['Hujjat raqami va sanasi'] ||
        `№${idx + 1}`
      ).trim();

      const docType = String(row['Hujjat turi'] || 'Hujjat').trim();
      const taskType = String(row['Topshiriq turi'] || 'Ijro topshirig‘i').trim();
      const notes = String(row['Izoh'] || '').trim();

      newTasks.push({
        id: crypto.randomUUID(),
        taskNumber,
        leaderId: dept.leaderId,
        docNumberAndDate: title,
        docType,
        taskType,
        title,
        departmentId: dept.id,
        departmentName: dept.name,
        responsiblePerson: headName || dept.headName,
        deadline: deadline || new Date().toISOString().split('T')[0],
        status,
        completedDate: status === 'completed' ? new Date().toISOString() : null,
        delayDays: status === 'overdue' ? (delayDays || 1) : 0,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    if (importMode === 'replace') {
      db.data.tasks = newTasks;
    } else {
      db.data.tasks = [...newTasks, ...db.data.tasks];
    }

    db.save();

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch (_) {}

    res.json({
      success: true,
      importedCount: newTasks.length,
      addedDeptsCount,
      totalTasks: db.data.tasks.length,
      message: `Muvaffaqiyatli import qilindi: ${newTasks.length} ta topshiriq.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Excel faylini o‘qishda xatolik: ' + err.message });
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
router.post('/departments', uploadPortrait.single('photo'), (req, res) => {
  try {
    const { name, headName, headTitle = 'Mas’ul rahbar', leaderId, status = 'active' } = req.body;
    if (!name || !headName) {
      return res.status(400).json({ error: 'Boshqarma nomi va rahbar ismi kiritilishi shart.' });
    }

    let photoUrl = '';
    if (req.file) {
      photoUrl = `/uploads/portraits/${req.file.filename}`;
    }

    let assignedLeaderId = parseInt(leaderId, 10);
    if (isNaN(assignedLeaderId) || assignedLeaderId <= 0) {
      assignedLeaderId = db.getNextLeaderId();
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
router.put('/departments/:id', uploadPortrait.single('photo'), (req, res) => {
  try {
    const index = db.data.departments.findIndex(d => d.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Boshqarma topilmadi.' });

    const currentDept = db.data.departments[index];
    const { name, headName, headTitle, leaderId, status, deletePhoto } = req.body;

    let photoUrl = currentDept.photo;
    if (deletePhoto === 'true' || deletePhoto === true || deletePhoto === '1') {
      photoUrl = '';
    }
    if (req.file) {
      photoUrl = `/uploads/portraits/${req.file.filename}`;
    }

    let updatedLeaderId = currentDept.leaderId;
    if (leaderId !== undefined && String(leaderId).trim() !== '') {
      const parsed = parseInt(leaderId, 10);
      if (!isNaN(parsed) && parsed > 0) updatedLeaderId = parsed;
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
