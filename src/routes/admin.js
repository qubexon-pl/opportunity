/**
 * Admin panel: who may use the app and the teams, and which team owns which
 * people. Superadmins manage every team and the teams themselves; admins
 * manage only the users, people and roles of their own teams. The lists
 * follow the team picked in the top bar.
 */
const express = require('express');
const access = require('../services/accessService');
const { requireAdmin, requireSuperadmin } = require('../middleware/access');
const { listAllPeople, movePersonToTeam, getRoleMap } = require('../services/peopleService');
const { countOpportunitiesByTeam } = require('../services/opportunityService');
const { searchDirectoryUsers } = require('../services/graphService');

const router = express.Router();

const EVERY_TEAM = Object.freeze({ all: true, teamId: null, teamIds: [], writeTeamId: access.DEFAULT_TEAM_ID, key: 'all' });

/* The team picker in the top bar posts here, for admins and for members in
   more than one team. A member can only pick one of their own teams. */
router.post('/view-team', (req, res) => {
  const back = safeBack(req);
  if (!req.access) return res.redirect(back);
  const teamId = String(req.body.teamId || '');
  const allowed = (req.access.writableTeams || []).some((team) => team.id === teamId);
  req.session.viewTeamId = allowed ? teamId : '';
  res.redirect(back);
});

router.use(requireAdmin);

/** Only same-site paths, so the redirect cannot be pointed elsewhere. */
function safeBack(req) {
  const referer = String(req.get('Referer') || '');
  try {
    const url = new URL(referer, `${req.protocol}://${req.get('host')}`);
    if (url.host === req.get('host') && url.pathname.startsWith('/')) return url.pathname + url.search;
  } catch (_err) {
    /* fall through */
  }
  return '/';
}

/** "Miasik, Jakub" or "Jakub Miasik" -> "Miasik". */
function lastNameOf(name) {
  const text = String(name || '').trim();
  if (text.includes(',')) return text.split(',')[0].trim();
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] || text;
}

/** The teams this admin manages: every team for superadmins, their own otherwise. */
function managedTeamIds(req) {
  return req.access.isSuperadmin ? access.listTeams().map((team) => team.id) : (req.access.writableTeams || []).map((team) => team.id);
}

function assertManages(req, teamId) {
  if (!managedTeamIds(req).includes(String(teamId || ''))) throw new Error('You can only manage your own teams.');
}

/** Whether this admin may change or remove a listed user. */
function canManageUser(req, user, { remove = false } = {}) {
  if (req.access.isSuperadmin) return true;
  if (!user || user.role === 'superadmin' || access.envAdminEmails().includes(user.email)) return false;
  const managed = managedTeamIds(req);
  return remove ? user.teamIds.every((id) => managed.includes(id)) : user.teamIds.some((id) => managed.includes(id));
}

async function act(req, res, work) {
  try {
    const message = await work();
    if (message) req.flash('success', message);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/admin');
}

router.get('/', async (req, res, next) => {
  try {
    const managed = managedTeamIds(req);
    const teams = access.listTeams().filter((team) => managed.includes(team.id));
    const scope = req.access.scope || {};
    const viewTeamId = !scope.all && scope.teamIds && scope.teamIds.length === 1 ? scope.teamIds[0] : '';
    const inView = (teamId) => managed.includes(teamId) && (!viewTeamId || teamId === viewTeamId);
    const allUsers = access.listUsers();
    const users = allUsers.filter((user) => user.teamIds.some(inView));
    const roleMap = getRoleMap();
    const people = listAllPeople()
      .map((name) => ({ name, lastName: lastNameOf(name), role: roleMap[name] || '', teamId: access.personTeam(name) }))
      .filter((person) => inView(person.teamId))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name));

    let opportunityCounts = {};
    let loadError = null;
    try {
      opportunityCounts = await access.runWithScope(EVERY_TEAM, () => countOpportunitiesByTeam());
    } catch (err) {
      loadError = err.message || String(err);
    }

    const teamStats = teams.filter((team) => inView(team.id)).map((team) => ({
      ...team,
      isDefault: team.id === access.DEFAULT_TEAM_ID,
      users: users.filter((user) => user.teamIds.includes(team.id)).length,
      people: people.filter((person) => person.teamId === team.id).length,
      opportunities: opportunityCounts[team.id] || 0,
    }));

    const envAdmins = access.envAdminEmails();
    const teamRoles = teams.filter((team) => inView(team.id)).map((team) => {
      const teamPeople = people.filter((person) => person.teamId === team.id);
      return {
        ...team,
        roles: access.listJobTitles(team.id).map((title) => ({
          title,
          people: teamPeople.filter((person) => roleMap[person.name] === title).length,
        })),
      };
    });
    res.render('admin', {
      title: 'Admin',
      teams,
      teamStats,
      teamRoles,
      users: users.map((user) => ({
        ...user,
        envAdmin: envAdmins.includes(user.email),
        role: envAdmins.includes(user.email) ? 'superadmin' : user.role,
        editable: canManageUser(req, user),
        removable: canManageUser(req, user, { remove: true }),
        otherTeams: user.teamIds.filter((id) => !managed.includes(id)).length,
      })),
      envAdmins: req.access.isSuperadmin ? envAdmins.filter((email) => !allUsers.some((user) => user.email === email)) : [],
      isSuperadmin: req.access.isSuperadmin,
      roleLabels: access.ROLE_LABELS,
      people,
      viewTeamId,
      viewTeamName: viewTeamId ? access.teamName(viewTeamId) : '',
      loadError,
      roles: req.access.isSuperadmin ? access.ROLES : access.ROLES.filter((role) => role !== 'superadmin'),
      me: req.access.email,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Directory lookup behind the "add user" email box. Uses Microsoft Graph when
 * the app identity may read users; otherwise falls back to people already on
 * the list, so the box still helps when Graph is not set up.
 */
router.get('/directory-search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ ok: true, source: 'none', users: [] });
  const local = access
    .listUsers()
    .filter((user) => canManageUser(req, user))
    .filter((user) => `${user.email} ${user.name}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 10)
    .map((user) => ({ email: user.email, name: user.name, listed: true }));
  try {
    const found = await searchDirectoryUsers(query);
    const listed = new Set(access.listUsers().map((user) => user.email));
    res.json({
      ok: true,
      source: 'entra',
      users: found.map((user) => ({ ...user, listed: listed.has(access.normalizeEmail(user.email)) })),
    });
  } catch (err) {
    console.warn('[Admin] Directory search unavailable:', err.message || err);
    // Only admins reach this route, so the reason is shown to help them fix the setup.
    const reason = String(err.message || err).slice(0, 400);
    res.json({
      ok: true,
      source: 'local',
      warning: `Entra ID search is unavailable (${reason}); showing people already on the list.`,
      users: local,
    });
  }
});

/** Checkbox groups post a single value or an array. */
function listValue(value) {
  return [].concat(value === undefined ? [] : value).map(String).filter(Boolean);
}

router.post('/users', (req, res) =>
  act(req, res, async () => {
    let teamIds = listValue(req.body.teamIds);
    const role = String(req.body.role || 'member').toLowerCase();
    if (!req.access.isSuperadmin) {
      if (role === 'superadmin') throw new Error('Only superadmins can make someone a superadmin.');
      teamIds.forEach((id) => assertManages(req, id));
      const existing = access.findUser(req.body.email);
      if (existing && !canManageUser(req, existing)) throw new Error('You can only change users of your own teams.');
      // Keep the teams this admin does not manage.
      const managed = managedTeamIds(req);
      if (existing) teamIds = [...new Set(teamIds.concat(existing.teamIds.filter((id) => !managed.includes(id))))];
    }
    const { user, created } = await access.saveUser(
      { email: req.body.email, name: req.body.name, role, teamIds },
      req.access.email
    );
    return created ? `${user.email} can now use the app.` : `${user.email} updated.`;
  })
);

router.post('/users/remove', (req, res) =>
  act(req, res, async () => {
    const email = access.normalizeEmail(req.body.email);
    if (!canManageUser(req, access.findUser(email), { remove: true })) throw new Error('Only superadmins can remove users who belong to other teams.');
    await access.removeUser(email);
    return `${email} no longer has access.`;
  })
);

router.post('/teams', requireSuperadmin, (req, res) =>
  act(req, res, async () => {
    const team = await access.addTeam(req.body.name);
    return `Team ${team.name} created.`;
  })
);

router.post('/teams/rename', (req, res) =>
  act(req, res, async () => {
    assertManages(req, req.body.teamId);
    await access.renameTeam(String(req.body.teamId || ''), req.body.name);
    return 'Team renamed.';
  })
);

router.post('/teams/remove', requireSuperadmin, (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    const counts = await access.runWithScope(EVERY_TEAM, () => countOpportunitiesByTeam());
    const name = access.teamName(teamId);
    await access.removeTeam(teamId, { opportunityCount: counts[teamId] || 0 });
    if (req.session.viewTeamId === teamId) req.session.viewTeamId = '';
    return `Team ${name} removed.`;
  })
);

router.post('/people/team', (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    assertManages(req, teamId);
    assertManages(req, access.personTeam(req.body.person));
    await movePersonToTeam(req.body.person, teamId);
    return `${String(req.body.person || '').trim()} moved to ${access.teamName(teamId)}.`;
  })
);

/** Roles (job titles) people in a team are given in Configuration. */
router.post('/roles', (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    assertManages(req, teamId);
    const title = await access.addJobTitle(teamId, req.body.title);
    return `Role ${title} added to ${access.teamName(teamId)}.`;
  })
);

router.post('/roles/remove', (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    const title = String(req.body.title || '').trim();
    assertManages(req, teamId);
    await access.removeJobTitle(teamId, title);
    return `Role ${title} removed from ${access.teamName(teamId)}. People who had it keep it until changed.`;
  })
);

module.exports = router;
