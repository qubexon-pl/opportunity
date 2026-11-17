/**
 * Admin panel: who may use the app, the teams, and which team owns which
 * people and opportunities. Everything here is admin only, and always looks
 * at every team regardless of the team the admin is currently viewing.
 */
const express = require('express');
const access = require('../services/accessService');
const { requireAdmin } = require('../middleware/access');
const { listAllPeople, movePersonToTeam } = require('../services/peopleService');
const { listOpportunities, countOpportunitiesByTeam, moveOpportunityToTeam } = require('../services/opportunityService');

const router = express.Router();

const EVERY_TEAM = Object.freeze({ all: true, teamId: null, writeTeamId: access.DEFAULT_TEAM_ID, key: 'all' });

/* The team picker in the top bar posts here. It sits before requireAdmin's
   page guard only to give members a plain answer instead of an error page. */
router.post('/view-team', (req, res) => {
  const back = safeBack(req);
  if (!req.access || !req.access.isAdmin) return res.redirect(back);
  const teamId = String(req.body.teamId || '');
  req.session.viewTeamId = teamId && access.findTeam(teamId) ? teamId : '';
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
  res.redirect(req.body.returnTo === 'opportunities' ? '/admin#teamOpportunities' : '/admin');
}

router.get('/', async (req, res, next) => {
  try {
    const teams = access.listTeams();
    const users = access.listUsers();
    const people = listAllPeople()
      .map((name) => ({ name, teamId: access.personTeam(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let opportunities = [];
    let opportunityCounts = {};
    let loadError = null;
    try {
      [opportunities, opportunityCounts] = await access.runWithScope(EVERY_TEAM, () =>
        Promise.all([listOpportunities({ sort: 'name', dir: 'asc' }), countOpportunitiesByTeam()])
      );
    } catch (err) {
      loadError = err.message || String(err);
    }

    const teamStats = teams.map((team) => ({
      ...team,
      isDefault: team.id === access.DEFAULT_TEAM_ID,
      users: users.filter((user) => user.teamId === team.id).length,
      people: people.filter((person) => person.teamId === team.id).length,
      opportunities: opportunityCounts[team.id] || 0,
    }));

    const envAdmins = access.envAdminEmails();
    res.render('admin', {
      title: 'Admin',
      teams,
      teamStats,
      users: users.map((user) => ({ ...user, envAdmin: envAdmins.includes(user.email) })),
      envAdmins: envAdmins.filter((email) => !users.some((user) => user.email === email)),
      people,
      opportunities: opportunities.map((opp) => ({
        id: opp.Id,
        name: opp.Name,
        stage: opp.Stage,
        status: opp.Status,
        teamId: opp.TeamId && access.findTeam(opp.TeamId) ? String(opp.TeamId) : access.DEFAULT_TEAM_ID,
      })),
      loadError,
      roles: access.ROLES,
      me: req.access.email,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users', (req, res) =>
  act(req, res, async () => {
    const { user, created } = await access.saveUser(
      { email: req.body.email, name: req.body.name, role: req.body.role, teamId: req.body.teamId },
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

router.post('/opportunities/team', (req, res) =>
  act(req, res, async () => {
    const team = access.findTeam(req.body.teamId);
    if (!team) throw new Error('Choose an existing team.');
    await moveOpportunityToTeam(req.body.id, team.id);
    return `Opportunity moved to ${team.name}.`;
  })
);

module.exports = router;
