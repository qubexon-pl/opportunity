/**
 * Turns the signed-in person into what they may see.
 *
 * Runs after authentication and the settings refresh (the allow-list lives
 * with the settings). People not on the list get a plain "no access" page
 * rather than an empty app; everyone else runs the rest of the request inside
 * their team scope.
 */
const access = require('../services/accessService');

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts(['html', 'json']) === 'json';
}

async function authorize(req, res, next) {
  if (req.path === '/health' || req.path === '/api/health') return next();

  const resolved = access.resolveAccess(req.user);
  if (!resolved.allowed) {
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'You do not have access to this app. Ask an administrator to add you.' });
    return res.status(403).render('no-access', {
      title: 'No access',
      email: resolved.email || '',
      signOutUrl: res.locals.signOutUrl,
    });
  }

  if (resolved.bootstrap) {
    // First sign-in on an empty list: keep this person as the first admin, so
    // the list is never empty again and nobody else can claim it.
    try {
      await access.saveUser({ email: resolved.email, name: req.user && req.user.name, role: 'admin' }, resolved.email);
      console.log(`[Access] ${resolved.email} is the first admin.`);
    } catch (err) {
      console.warn('[Access] Could not record the first admin:', err.message || err);
    }
  }

  const isAdmin = resolved.role === 'admin';
  const viewTeamId = isAdmin && req.session ? req.session.viewTeamId || '' : '';
  const scope = access.buildScope(resolved, viewTeamId);

  req.access = { ...resolved, isAdmin, scope };
  res.locals.access = {
    isAdmin,
    role: resolved.role,
    teamId: resolved.teamId,
    teamName: access.teamName(resolved.teamId),
    viewingAll: scope.all,
    viewTeamId: scope.all ? '' : scope.teamId,
    viewTeamName: scope.all ? 'All teams' : access.teamName(scope.teamId),
    teams: isAdmin ? access.listTeams() : [],
  };

  access.runWithScope(scope, () => next());
}

function requireAdmin(req, res, next) {
  if (req.access && req.access.isAdmin) return next();
  if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'Only admins can do that.' });
  res.status(403).render('error', {
    title: 'Admins only',
    message: 'Only admins can open this page.',
    currentPath: req.path,
    breadcrumb: [{ label: 'Admins only', href: '#' }],
  });
}

module.exports = { authorize, requireAdmin };
