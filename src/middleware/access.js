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

function authorize(req, res, next) {
  if (req.path === '/health' || req.path === '/api/health') return next();

  const resolved = access.resolveAccess(req.user);
  if (!resolved.allowed) {
    // Not on the allow-list: drop any app session so nothing carries over, and
    // offer a way to sign out of the identity provider or switch account.
    if (req.session && typeof req.session.destroy === 'function') req.session.destroy(() => {});
    if (resolved.email) console.warn(`[Access] Refused ${resolved.email}: not on the allow-list.`);
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'You do not have access to this app. Ask an administrator to add you.' });
    return res.status(403).render('no-access', {
      title: 'No access',
      email: resolved.email || '',
      signOutUrl: res.locals.signOutUrl,
    });
  }

  const isAdmin = resolved.role === 'admin';
  const writableTeams = access.teamsFor(resolved);
  const scope = access.buildScope(resolved, req.session ? req.session.viewTeamId || '' : '');
  const viewingAll = scope.teamIds.length !== 1;

  req.access = { ...resolved, isAdmin, scope, writableTeams };
  res.locals.access = {
    isAdmin,
    role: resolved.role,
    teamId: resolved.teamId,
    teamName: writableTeams.map((team) => team.name).join(', ') || access.teamName(resolved.teamId),
    viewingAll,
    viewTeamId: viewingAll ? '' : scope.teamIds[0],
    viewTeamName: viewingAll ? (isAdmin ? 'All teams' : 'All my teams') : access.teamName(scope.teamIds[0]),
    teams: writableTeams,
    writableTeams,
    writeTeamId: scope.writeTeamId,
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
