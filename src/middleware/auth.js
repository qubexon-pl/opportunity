/**
 * Who is signed in.
 *
 * The app does not run its own login. In Azure it sits behind App Service
 * Authentication ("Easy Auth") with Microsoft Entra ID: the platform signs the
 * person in and forwards their identity in X-MS-CLIENT-PRINCIPAL* headers. Those
 * headers are only trusted when Easy Auth is actually in front of the app
 * (App Service sets WEBSITE_AUTH_ENABLED, or AUTH_PROVIDER=easyauth says so);
 * anywhere else they could be sent by anyone.
 *
 * Settings:
 *   AUTH_PROVIDER=easyauth   trust the Easy Auth headers (auto-detected on App Service)
 *   AUTH_REQUIRED=true       refuse requests with no signed-in person
 *   DEV_USER_NAME / DEV_USER_EMAIL   pretend to be someone locally
 */

function easyAuthEnabled() {
  return (
    String(process.env.AUTH_PROVIDER || '').toLowerCase() === 'easyauth' ||
    String(process.env.WEBSITE_AUTH_ENABLED || '').toLowerCase() === 'true'
  );
}

function authRequired() {
  return String(process.env.AUTH_REQUIRED || '').toLowerCase() === 'true';
}

/** Reads the claims Easy Auth forwards, tolerating either header form. */
function userFromEasyAuth(headers) {
  const encoded = headers['x-ms-client-principal'];
  let claims = [];
  if (encoded) {
    try {
      const principal = JSON.parse(Buffer.from(String(encoded), 'base64').toString('utf8'));
      claims = Array.isArray(principal.claims) ? principal.claims : [];
    } catch (err) {
      claims = [];
    }
  }
  const claim = (...types) => {
    for (const type of types) {
      const found = claims.find((c) => c && (c.typ === type || c.type === type));
      if (found && (found.val || found.value)) return String(found.val || found.value);
    }
    return '';
  };

  const email =
    claim('preferred_username', 'email', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'upn') ||
    String(headers['x-ms-client-principal-name'] || '');
  const id =
    claim('http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid') ||
    String(headers['x-ms-client-principal-id'] || '') ||
    email;
  const name = claim('name') || email;

  if (!id && !email) return null;
  return { id: id || email, name: name || email, email, provider: 'easyauth' };
}

function userFromDevSettings() {
  const name = String(process.env.DEV_USER_NAME || '').trim();
  const email = String(process.env.DEV_USER_EMAIL || '').trim();
  if (!name && !email) return null;
  return { id: email || name, name: name || email, email, provider: 'dev' };
}

function resolveUser(req) {
  if (easyAuthEnabled()) {
    const user = userFromEasyAuth(req.headers || {});
    if (user) return user;
  }
  if (process.env.NODE_ENV !== 'production') return userFromDevSettings();
  return null;
}

function authenticate(req, res, next) {
  req.user = resolveUser(req);
  res.locals.currentUser = req.user;
  res.locals.signOutUrl = req.user && req.user.provider === 'easyauth' ? '/.auth/logout?post_logout_redirect_uri=/' : null;

  if (!req.user && authRequired()) {
    if (req.path === '/health' || req.path === '/api/health') return next();
    if (easyAuthEnabled()) return res.redirect('/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(req.originalUrl));
    return res.status(401).send('Sign-in required.');
  }
  next();
}

/** The id saved preferences are stored under, or null when nobody is signed in. */
function userKey(req) {
  return req && req.user ? req.user.id : null;
}

module.exports = { authenticate, userFromEasyAuth, resolveUser, userKey, easyAuthEnabled };
