const express = require('express');
const router = express.Router();
const { db, computeTaskStatus } = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/tasks
router.get('/', (req, res) => {
  try {
    const { status, departmentId, search, page = 1, pageSize = 20 } = req.query;

    db.syncTasksStatus(true);
    const now = new Date();

    let tasks = db.data.tasks.map(t => {
      const computed = computeTaskStatus(t, now);
      return {
        ...t,
        computedStatus: computed.status,
        delayDays: computed.delayDays
      };
    });

    // Filter by status
    if (status && status !== 'all') {
      if (status === 'overdue') {
        tasks = tasks.filter(t => t.computedStatus === 'overdue');
      } else if (status === 'in_progress') {
        tasks = tasks.filter(t => t.computedStatus === 'in_progress');
      } else if (status === 'completed') {
        tasks = tasks.filter(t => t.computedStatus === 'completed');
      }
    }

    // Filter by departmentId
    if (departmentId && departmentId !== 'all') {
      tasks = tasks.filter(t => t.departmentId === departmentId);
    }

    // Search query
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      tasks = tasks.filter(t =>
        (t.taskNumber && t.taskNumber.toLowerCase().includes(q)) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.docNumberAndDate && t.docNumberAndDate.toLowerCase().includes(q)) ||
        (t.responsiblePerson && t.responsiblePerson.toLowerCase().includes(q)) ||
        (t.departmentName && t.departmentName.toLowerCase().includes(q)) ||
        (t.docType && t.docType.toLowerCase().includes(q)) ||
        (t.taskType && t.taskType.toLowerCase().includes(q))
      );
    }

    // Sort: overdue first (highest delay days), then deadline asc
    tasks.sort((a, b) => {
      if (a.computedStatus === 'overdue' && b.computedStatus !== 'overdue') return -1;
      if (a.computedStatus !== 'overdue' && b.computedStatus === 'overdue') return 1;
      if (a.computedStatus === 'overdue' && b.computedStatus === 'overdue') {
        return (b.delayDays || 0) - (a.delayDays || 0);
      }
      return (a.deadline || '').localeCompare(b.deadline || '');
    });

    const total = tasks.length;
    const p = Math.max(1, parseInt(page) || 1);
    const limit = Math.max(1, parseInt(pageSize) || 20);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIndex = (p - 1) * limit;
    const items = tasks.slice(startIndex, startIndex + limit);

    res.json({
      items,
      total,
      page: p,
      pageSize: limit,
      totalPages
    });
  } catch (err) {
    res.status(500).json({ error: 'Topshiriqlarni olishda xatolik yuz berdi: ' + err.message });
  }
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const task = db.data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
  res.json(task);
});

module.exports = router;
