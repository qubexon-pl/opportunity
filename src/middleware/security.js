const crypto = require('crypto');

/*
 * Scripts run only from this origin, plus the one small inline script in the
 * page head (theme before first paint) which carries a per-request nonce.
 * Styles still allow inline attributes: the timeline and capacity bars size
 * themselves with computed style="left/width" values.
 */
function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders(_req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

function createRateLimiter({ windowMs = 60 * 1000, max = 120 } = {}) {
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    return next();
  };
}

module.exports = { securityHeaders, createRateLimiter, contentSecurityPolicy };
