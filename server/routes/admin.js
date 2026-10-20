const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  clearAllTasks,
  getDepartments,
  getNextLeaderId,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
  getImportsHistory
} = require('../postgres');
const { importExcelAtomic } = require('../excel-importer');
const { uploadPortrait, deletePortrait } = require('../storage');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Multer in-memory storage for photos (10MB)
const uploadPortraitMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Faqat rasm fayllari (JPG, PNG, WEBP) qabul qilinadi.'));
    }
  }
});

const handlePortraitUpload = (req, res, next) => {
  uploadPortraitMulter.single('photo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Rasm yuklashda xatolik: ' + err.message });
    }
    next();
  });
};

// Multer in-memory storage for Excel files (30MB)
const uploadExcelMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

const handleExcelUpload = (req, res, next) => {
  uploadExcelMulter.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Excel faylini yuklashda xatolik: ' + err.message });
    }
    next();
  });
};

// Protect all admin routes with authentication and admin role enforcement
router.use(authenticate, requireAdmin);

// ==========================================
// 1. TASKS MANAGEMENT
// ==========================================

// GET /api/admin/tasks
router.get('/tasks', async (req, res, next) => {
  try {
    const { status, departmentId, search, page = 1, pageSize = 25 } = req.query;
    const result = await getTasks({ status, departmentId, search, page, pageSize });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tasks
router.post('/tasks', async (req, res, next) => {
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

    if (!title || !deadline) {
      return res.status(400).json({ error: 'Topshiriq mazmuni va ijro muddati to‘ldirilishi shart.' });
    }

    let departmentName = '';
    let leaderId = null;
    if (departmentId) {
      const depts = await getDepartments();
      const found = depts.find(d => d.id === departmentId);
      if (found) {
        departmentName = found.name;
        leaderId = found.leaderId;
      }
    }

    const newTask = await createTask({
      taskNumber,
      docNumberAndDate,
      docType,
      taskType,
      title,
      departmentId,
      departmentName,
      leaderId,
      responsiblePerson,
      deadline,
      status,
      notes
    });

    res.json({ success: true, task: newTask, message: 'Topshiriq muvaffaqiyatli yaratildi.' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/tasks/:id
router.put('/tasks/:id', async (req, res, next) => {
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
      status,
      notes
    } = req.body;

    let departmentName = undefined;
    if (departmentId) {
      const depts = await getDepartments();
      const found = depts.find(d => d.id === departmentId);
      if (found) departmentName = found.name;
    }

    const updatedTask = await updateTask(req.params.id, {
      taskNumber,
      docNumberAndDate,
      docType,
      taskType,
      title,
      departmentId,
      departmentName,
      responsiblePerson,
      deadline,
      status,
      notes
    });

    if (!updatedTask) {
      return res.status(404).json({ error: 'Topshiriq topilmadi.' });
    }

    res.json({ success: true, task: updatedTask, message: 'Topshiriq yangilandi.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/tasks/:id
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const deleted = await deleteTask(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
    res.json({ success: true, message: 'Topshiriq o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tasks/clear-all
router.post('/tasks/clear-all', async (req, res, next) => {
  try {
    const deletedCount = await clearAllTasks();
    res.json({
      success: true,
      deletedCount,
      message: `Barcha ${deletedCount} ta topshiriq butunlay tozalandi.`
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. EXCEL IMPORT & EXPORT
// ==========================================

// POST /api/admin/tasks/import-excel
router.post('/tasks/import-excel', handleExcelUpload, async (req, res, next) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Excel fayli yuklanmadi.' });
  }

  try {
    const result = await importExcelAtomic({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      importedBy: req.user ? req.user.username : 'admin'
    });

    res.json(result);
  } catch (err) {
    console.error('[Excel Import Error]:', err.message);
    res.status(400).json({ error: 'Excel importida xatolik: ' + err.message });
  }
});

// GET /api/admin/imports (Import history and version tracking)
router.get('/imports', async (req, res, next) => {
  try {
    const history = await getImportsHistory();
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/tasks/export-excel
router.get('/tasks/export-excel', async (req, res, next) => {
  try {
    const { items: tasks } = await getTasks({ status: 'all', page: 1, pageSize: 100000 });
    const departments = await getDepartments();

    const rows = tasks.map((t, idx) => ({
      '№': idx + 1,
      'Topshiriq ID': t.taskNumber || '',
      'Rahbar ID': t.leaderId || '',
      'Topshiriq turi': t.taskType || 'Ijro topshirig‘i',
      'Hujjat turi': t.docType || 'Hujjat',
      'Topshiriq mazmuni': t.title,
      'Mas’ul boshqarma': t.departmentName || '',
      'Mas’ul ijrochi': t.responsiblePerson || '',
      'Ijro muddati': t.deadline || '',
      'Holati': t.status === 'completed' ? 'Bajarilgan' : (t.status === 'overdue' ? 'Muddati o‘tgan' : 'Bajarish jarayonida'),
      'Kechikish kunlari': t.delayDays || 0,
      'Izoh': t.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Topshiriqlar');

    const directoryRows = departments.map(d => ({
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
    next(err);
  }
});

// GET /api/admin/tasks/template-excel
router.get('/tasks/template-excel', async (req, res, next) => {
  try {
    const departments = await getDepartments();

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
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const directoryRows = departments.map(d => ({
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
    next(err);
  }
});

// ==========================================
// 3. DEPARTMENTS & HEADS MANAGEMENT
// ==========================================

// GET /api/admin/departments/next-id
router.get('/departments/next-id', async (req, res, next) => {
  try {
    const nextId = await getNextLeaderId();
    res.json({ nextId });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/departments
router.get('/departments', async (req, res, next) => {
  try {
    const list = await getDepartments();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/departments
router.post('/departments', handlePortraitUpload, async (req, res, next) => {
  try {
    const { name, headName, headTitle = 'Mas’ul rahbar', leaderId, status = 'active' } = req.body;
    if (!name || !headName) {
      return res.status(400).json({ error: 'Boshqarma nomi va rahbar ismi kiritilishi shart.' });
    }

    let assignedLeaderId = parseInt(leaderId, 10);
    if (isNaN(assignedLeaderId) || assignedLeaderId <= 0) {
      assignedLeaderId = await getNextLeaderId();
    }

    let photoUrl = '';
    if (req.file) {
      photoUrl = await uploadPortrait(req.file.buffer, req.file.originalname, req.file.mimetype, assignedLeaderId);
    }

    const newDept = await createDepartment({
      leaderId: assignedLeaderId,
      name,
      headName,
      headTitle,
      photo: photoUrl,
      status
    });

    res.json({
      success: true,
      department: newDept,
      message: `Boshqarma va rahbar (#${assignedLeaderId}) muvaffaqiyatli yaratildi.`
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/departments/:id
router.put('/departments/:id', handlePortraitUpload, async (req, res, next) => {
  try {
    const depts = await getDepartments();
    const currentDept = depts.find(d => d.id === req.params.id);
    if (!currentDept) return res.status(404).json({ error: 'Boshqarma topilmadi.' });

    const { name, headName, headTitle, leaderId, status, deletePhoto } = req.body;

    let photoUrl = currentDept.photo;
    if (deletePhoto === 'true' || deletePhoto === true || deletePhoto === '1') {
      await deletePortrait(currentDept.photo);
      photoUrl = '';
    }

    if (req.file) {
      if (currentDept.photo) {
        await deletePortrait(currentDept.photo);
      }
      photoUrl = await uploadPortrait(req.file.buffer, req.file.originalname, req.file.mimetype, leaderId || currentDept.leaderId);
    }

    const updatedDept = await updateDepartment(req.params.id, {
      name,
      headName,
      headTitle,
      leaderId,
      photo: photoUrl,
      status
    });

    res.json({
      success: true,
      department: updatedDept,
      message: 'Boshqarma va fotosurat muvaffaqiyatli yangilandi.'
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/departments/:id
router.delete('/departments/:id', async (req, res, next) => {
  try {
    const deletedDept = await deleteDepartment(req.params.id);
    if (!deletedDept) return res.status(404).json({ error: 'Boshqarma topilmadi.' });

    if (deletedDept.photo) {
      await deletePortrait(deletedDept.photo);
    }

    res.json({ success: true, message: 'Boshqarma o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

// Standalone portrait upload/delete endpoints (Requirement 20)
router.post('/portrait', handlePortraitUpload, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Rasm fayli yuklanmadi.' });
  try {
    const leaderId = req.body.leaderId || 'new';
    const photoUrl = await uploadPortrait(req.file.buffer, req.file.originalname, req.file.mimetype, leaderId);
    res.json({ success: true, photoUrl });
  } catch (err) {
    next(err);
  }
});

router.delete('/portrait/:id', async (req, res, next) => {
  try {
    const depts = await getDepartments();
    const dept = depts.find(d => d.id === req.params.id);
    if (dept && dept.photo) {
      await deletePortrait(dept.photo);
      await updateDepartment(dept.id, { photo: '' });
    }
    res.json({ success: true, message: 'Fotosurat o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. USERS MANAGEMENT
// ==========================================

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users
router.post('/users', async (req, res, next) => {
  try {
    const { username, password, fullName, role = 'viewer' } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'Foydalanuvchi nomi, parol va F.I.SH. to‘ldirilishi shart.' });
    }

    const newUser = await createUser({ username, password, fullName, role });
    res.json({ success: true, user: newUser, message: 'Foydalanuvchi muvaffaqiyatli qo‘shildi.' });
  } catch (err) {
    if (err.message && err.message.includes('unique') || err.code === '23505') {
      return res.status(400).json({ error: 'Bunday loginli foydalanuvchi allaqachon mavjud.' });
    }
    next(err);
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res, next) => {
  try {
    const { username, password, fullName, role } = req.body;
    const updated = await updateUser(req.params.id, { username, password, fullName, role });
    if (!updated) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
    res.json({ success: true, user: updated, message: 'Foydalanuvchi ma’lumotlari yangilandi.' });
  } catch (err) {
    if (err.message && err.message.includes('unique') || err.code === '23505') {
      return res.status(400).json({ error: 'Bu foydalanuvchi nomi band.' });
    }
    next(err);
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res, next) => {
  try {
    if (req.user && req.user.id === req.params.id) {
      return res.status(400).json({ error: 'O‘z hisobingizni o‘chira olmaysiz.' });
    }
    const deleted = await deleteUser(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
    res.json({ success: true, message: 'Foydalanuvchi o‘chirildi.' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. SETTINGS MANAGEMENT
// ==========================================

// GET /api/admin/settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/settings
router.put('/settings', async (req, res, next) => {
  try {
    const { orgName, subOrgName, systemTitle } = req.body;
    const updated = await updateSettings({
      orgName: orgName ? orgName.trim() : undefined,
      subOrgName: subOrgName ? subOrgName.trim() : undefined,
      systemTitle: systemTitle ? systemTitle.trim() : undefined
    });
    res.json({ success: true, settings: updated, message: 'Sozlamalar saqlandi.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
