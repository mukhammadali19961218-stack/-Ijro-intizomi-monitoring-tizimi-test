const express = require('express');
const router = express.Router();
const { getTasks, getTaskById } = require('../postgres');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/tasks
router.get('/', async (req, res, next) => {
  try {
    const { status, departmentId, search, page = 1, pageSize = 20 } = req.query;
    const result = await getTasks({
      status,
      departmentId,
      search,
      page,
      pageSize
    });
    res.json(result);
  } catch (err) {
    console.error('[Tasks List Error]:', err.message);
    res.status(500).json({ error: 'Topshiriqlarni olishda xatolik yuz berdi: ' + err.message });
  }
});

// GET /api/tasks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
    res.json(task);
  } catch (err) {
    console.error('[Task Detail Error]:', err.message);
    res.status(500).json({ error: 'Topshiriq ma’lumotini olishda xatolik: ' + err.message });
  }
});

module.exports = router;
