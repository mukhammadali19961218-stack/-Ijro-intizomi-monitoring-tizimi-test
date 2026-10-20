const express = require('express');
const router = express.Router();
const { getStats, getDepartmentOverdueStats, getSettings } = require('../postgres');
const { authenticate } = require('../middleware/auth');

// All dashboard endpoints require authentication
router.use(authenticate);

// GET /api/dashboard/stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    console.error('[Dashboard Stats Error]:', err.message);
    res.status(500).json({ error: 'Statistikani olishda xatolik yuz berdi: ' + err.message });
  }
});

// GET /api/dashboard/departments
router.get('/departments', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 3;
    const onlyOverdue = req.query.onlyOverdue !== 'false';
    const result = await getDepartmentOverdueStats(page, pageSize, onlyOverdue);
    res.json(result);
  } catch (err) {
    console.error('[Dashboard Departments Error]:', err.message);
    res.status(500).json({ error: 'Boshqarmalar ma’lumotini olishda xatolik yuz berdi: ' + err.message });
  }
});

// GET /api/dashboard/settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      ...settings,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Dashboard Settings Error]:', err.message);
    res.status(500).json({ error: 'Sozlamalarni olishda xatolik yuz berdi: ' + err.message });
  }
});

module.exports = router;
