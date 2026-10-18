const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Foydalanuvchi nomi va parol kiritilishi shart.' });
  }

  const user = db.data.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Foydalanuvchi nomi yoki parol noto‘g‘ri.' });
  }

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Foydalanuvchi nomi yoki parol noto‘g‘ri.' });
  }

  const tokenPayload = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

  res.cookie('ijro_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    token,
    user: tokenPayload
  });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: req.user
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('ijro_token');
  res.json({ success: true, message: 'Tizimdan muvaffaqiyatli chiqildi.' });
});

module.exports = router;
