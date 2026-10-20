require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { authenticate, requireAdmin } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const tasksRoutes = require('./routes/tasks');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

const publicDir = fs.existsSync(path.join(__dirname, '..', 'public'))
  ? path.join(__dirname, '..', 'public')
  : path.join(process.cwd(), 'public');

// Disable ETag globally to prevent 304 stale caching
app.set('etag', false);

// Static files (CSS, JS, images)
app.use(express.static(publicDir, {
  etag: false,
  setHeaders: (res, filePath) => {
    if (
      filePath.endsWith('.js') ||
      filePath.endsWith('.css') ||
      filePath.includes('uploads') ||
      filePath.includes('portraits') ||
      filePath.match(/\.(jpg|jpeg|png|webp|svg)$/i)
    ) {
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
    }
  }
}));

// Disable caching for all API endpoints to guarantee instant single-source-of-truth sync
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/admin', adminRoutes);

// Page routes with role enforcement
app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/dashboard', authenticate, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/admin', authenticate, requireAdmin, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Root redirects to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Catch-all 404
app.use((req, res) => {
  if (req.accepts('html')) {
    res.redirect('/dashboard');
  } else {
    res.status(404).json({ error: 'Sahifa topilmadi' });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.message);
  const status = err.status || 500;
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: err.message || 'Serverda xatolik yuz berdi'
    });
  }
  res.status(status).send('Server xatosi: ' + (err.message || 'Noma’lum xatolik'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`- Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`- Admin panel: http://localhost:${PORT}/admin`);
    console.log(`- Login: http://localhost:${PORT}/login`);
  });
}

module.exports = app;
