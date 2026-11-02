require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { getConfig, refreshSettings } = require('./config/settings');
const { securityHeaders, createRateLimiter } = require('./middleware/security');
const { authenticate } = require('./middleware/auth');

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
// Bootstrap, its icons and the Inter font are served from the installed
// packages rather than public CDNs: no third-party requests, pinned versions,
// and the app works on networks that block those CDNs.
const vendorCache = { maxAge: isProduction ? '30d' : 0, immutable: isProduction };
const packageDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
app.use('/vendor/bootstrap', express.static(path.join(packageDir('bootstrap'), 'dist'), vendorCache));
app.use('/vendor/bootstrap-icons', express.static(path.join(packageDir('bootstrap-icons'), 'font'), vendorCache));
app.use('/vendor/inter', express.static(packageDir('@fontsource-variable/inter'), vendorCache));
app.use(
  express.static(path.join(__dirname, 'public'), {
    // Assets are referenced with a ?v= build stamp, so they can be cached hard.
    maxAge: isProduction ? '7d' : 0,
  })
);
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

// Health check BEFORE DB-dependent middleware so it always responds instantly
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use(authenticate);

// People, absences and saved filters live in the database; make sure this
// instance has a recent copy before anything reads them. Never blocks for long
// and never fails the request: the last good copy is used if the store is down.
app.use((_req, _res, next) => {
  refreshSettings().then(() => next(), () => next());
});

// Cache-busting stamp for static assets, changed on every restart/deploy.
const ASSET_VERSION = process.env.ASSET_VERSION || Date.now().toString(36);

// Global context: current path for sidebar highlighting + auto-breadcrumb
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.currentUser = req.user || null;
  res.locals.assetVersion = ASSET_VERSION;
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

// Error handler: the detail goes to the log with a reference, the person sees
// a plain message they can quote back. Development still shows the real error.
app.use((err, req, res, _next) => {
  const reference = crypto.randomBytes(4).toString('hex');
  console.error(`Unhandled error [${reference}] ${req.method} ${req.originalUrl}:`, err);
  const detail = isProduction ? null : err.message || String(err);
  if (req.path.startsWith('/api/') || req.get('X-Requested-With') === 'XMLHttpRequest') {
    return res.status(500).json({ ok: false, error: detail || `Something went wrong (reference ${reference}).`, reference });
  }
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: detail || 'Something went wrong on our side. Please try again in a moment.',
    reference,
    currentPath: req.path,
    breadcrumb: [{ label: 'Error', href: '#' }],
  });
});

module.exports = app;
