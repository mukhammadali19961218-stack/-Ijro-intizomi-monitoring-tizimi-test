const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

// All dashboard endpoints require authentication
router.use(authenticate);

// GET /api/dashboard/stats
router.get('/stats', (req, res) => {
  try {
    db.ensureFreshData();
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Statistikani olishda xatolik yuz berdi.' });
  }
});

// GET /api/dashboard/departments
router.get('/departments', (req, res) => {
  try {
    db.ensureFreshData();
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 3;
    const onlyOverdue = req.query.onlyOverdue !== 'false';
    const result = db.getDepartmentOverdueStats(page, pageSize, onlyOverdue);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Boshqarmalar ma’lumotini olishda xatolik yuz berdi.' });
  }
});

// GET /api/dashboard/settings
router.get('/settings', (req, res) => {
  try {
    db.ensureFreshData();
    res.json({
      ...db.data.settings,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Sozlamalarni olishda xatolik yuz berdi.' });
  }
});

module.exports = router;
