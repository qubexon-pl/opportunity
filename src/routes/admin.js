/**
 * Admin panel: who may use the app and the teams, and which team owns which
 * people. Everything here is admin only, and always looks at every team
 * regardless of the team the admin is currently viewing.
 */
const express = require('express');
const access = require('../services/accessService');
const { requireAdmin } = require('../middleware/access');
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
    const teams = access.listTeams();
    const users = access.listUsers();
    const people = listAllPeople()
      .map((name) => ({ name, teamId: access.personTeam(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let opportunityCounts = {};
    let loadError = null;
    try {
      opportunityCounts = await access.runWithScope(EVERY_TEAM, () => countOpportunitiesByTeam());
    } catch (err) {
      loadError = err.message || String(err);
    }

    const teamStats = teams.map((team) => ({
      ...team,
      isDefault: team.id === access.DEFAULT_TEAM_ID,
      users: users.filter((user) => user.teamIds.includes(team.id)).length,
      people: people.filter((person) => person.teamId === team.id).length,
      opportunities: opportunityCounts[team.id] || 0,
    }));

    const envAdmins = access.envAdminEmails();
    const roleMap = getRoleMap();
    const teamRoles = teams.map((team) => {
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
      users: users.map((user) => ({ ...user, envAdmin: envAdmins.includes(user.email) })),
      envAdmins: envAdmins.filter((email) => !users.some((user) => user.email === email)),
      people,
      loadError,
      roles: access.ROLES,
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
    res.json({ ok: true, source: 'local', warning: 'Entra ID search is unavailable; showing people already on the list.', users: local });
  }
});

/** Checkbox groups post a single value or an array. */
function listValue(value) {
  return [].concat(value === undefined ? [] : value).map(String).filter(Boolean);
}

router.post('/users', (req, res) =>
  act(req, res, async () => {
    const { user, created } = await access.saveUser(
      { email: req.body.email, name: req.body.name, role: req.body.role, teamIds: listValue(req.body.teamIds) },
      req.access.email
    );
    return created ? `${user.email} can now use the app.` : `${user.email} updated.`;
  })
);

router.post('/users/remove', (req, res) =>
  act(req, res, async () => {
    const email = access.normalizeEmail(req.body.email);
    await access.removeUser(email);
    return `${email} no longer has access.`;
  })
);

router.post('/teams', (req, res) =>
  act(req, res, async () => {
    const team = await access.addTeam(req.body.name);
    return `Team ${team.name} created.`;
  })
);

router.post('/teams/rename', (req, res) =>
  act(req, res, async () => {
    await access.renameTeam(String(req.body.teamId || ''), req.body.name);
    return 'Team renamed.';
  })
);

router.post('/teams/remove', (req, res) =>
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
    await movePersonToTeam(req.body.person, teamId);
    return `${String(req.body.person || '').trim()} moved to ${access.teamName(teamId)}.`;
  })
);

/** Roles (job titles) people in a team are given in Configuration. */
router.post('/roles', (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    const title = await access.addJobTitle(teamId, req.body.title);
    return `Role ${title} added to ${access.teamName(teamId)}.`;
  })
);

router.post('/roles/remove', (req, res) =>
  act(req, res, async () => {
    const teamId = String(req.body.teamId || '');
    const title = String(req.body.title || '').trim();
    await access.removeJobTitle(teamId, title);
    return `Role ${title} removed from ${access.teamName(teamId)}. People who had it keep it until changed.`;
  })
);

module.exports = router;
