const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function getJwtSecret() {
  if (!JWT_SECRET || String(JWT_SECRET).trim() === '') {
    throw new Error('Xavfsizlik konfiguratsiyasi xatosi: JWT_SECRET muhit o‘zgaruvchisi kiritilishi shart.');
  }
  return JWT_SECRET;
}

function authenticate(req, res, next) {
  // Check cookie or Authorization header
  let token = req.cookies ? req.cookies.ijro_token : null;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).json({ error: 'Autentifikatsiyadan o‘tilmagan. Iltimos, tizimga kiring.' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('ijro_token');
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).json({ error: 'Sessiya muddati tugagan yoki token noto‘g‘ri.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      return res.redirect('/dashboard?error=unauthorized_admin');
    }
    return res.status(403).json({ error: 'Ruxsat berilmagan. Ushbu amal faqat administrator uchun.' });
  }
  next();
}

module.exports = {
  getJwtSecret,
  authenticate,
  requireAdmin
};
