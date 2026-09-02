require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const path = require('path');
const { getConfig } = require('./config/settings');
const { securityHeaders, createRateLimiter } = require('./middleware/security');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Trust Azure load balancer
if (isProduction) {
  app.set('trust proxy', 1);
}

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(securityHeaders);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const config = getConfig();
if (isProduction && config.session.secret === 'dev-secret-change-me') {
  console.warn('[App] SESSION_SECRET is using the development default.');
}

app.use(
  session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(flash());
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 240 }));

// Global context: current path for sidebar highlighting + auto-breadcrumb
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.currentUser = req.user || null;
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError = req.flash('error');

  const labelMap = {
    opportunities: 'Opportunities',
    management: 'Management',
    settings: 'Configuration',
    new: 'New opportunity',
  };

  const segments = req.path.split('/').filter(Boolean);
  const breadcrumb = [];
  let href = '';
  segments.forEach((segment) => {
    href += '/' + segment;
    const label = labelMap[segment] || (segment.length > 20 ? segment.substring(0, 20) + '…' : segment);
    breadcrumb.push({ label, href });
  });
  res.locals.breadcrumb = breadcrumb;
  next();
});

// Health check BEFORE DB-dependent routes so it always responds instantly
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.use('/', require('./routes/index'));
app.use('/opportunities', require('./routes/opportunities'));
app.use('/management', require('./routes/management'));
app.use('/settings', require('./routes/settings'));
app.use('/api', require('./routes/api'));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: `Page not found: ${req.path}`,
    currentPath: req.path,
    breadcrumb: [{ label: 'Not found', href: '#' }],
  });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    title: 'Error',
    message: err.message || 'An unexpected error occurred.',
    currentPath: req.path,
    breadcrumb: [{ label: 'Error', href: '#' }],
  });
});

module.exports = app;
