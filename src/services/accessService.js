/**
 * Who may use the app, and which team's data they see.
 *
 * Access is an allow-list kept with the other settings (dbo.AppSettings, or
 * config.local.json without a database):
 *
 *   appUsers  [{ email, name, role: 'admin' | 'member', teamIds: [id, ...], addedAt, addedBy }]
 *   teams     [{ id, name }]
 *   teamJobTitles  { [teamId]: ['Data Scientist', ...] }   roles people in a team pick from
 *
 * A member sees and edits only their own teams: the people configured for
 * them, the opportunities created in them and everything hanging off those
 * (assignments, notes, next steps, absences). Someone in several teams sees
 * them together and can narrow the view to one. An admin sees every team, can
 * narrow the view to one, and manages the allow-list and the teams.
 *
 * Only people on the list get in. Emails in ADMIN_EMAILS (comma separated) are
 * always admins, which is how the first admin of a fresh deployment gets in;
 * nobody is let in just for being first.
 *
 * Data created before teams existed has no team, and belongs to the default
 * team. The default team cannot be deleted, only renamed.
 *
 * The scope travels with the request through AsyncLocalStorage, so the data
 * services can filter without every caller passing it along. Code running
 * outside a request (tests, scripts) is unrestricted.
 */
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const store = require('../config/store');

const DEFAULT_TEAM_ID = 'default';
const DEFAULT_TEAM_NAME = 'Default team';
const ROLES = ['admin', 'member'];

/* What the default team used before roles could be set per team. */
const DEFAULT_JOB_TITLES = Object.freeze([
  'Associate Expert Data Intelligence',
  'Expert Data Intelligence',
  'Sr Expert Data Intelligence',
  'Lead Expert Data Intelligence',
]);

const UNRESTRICTED = Object.freeze({ all: true, teamId: null, teamIds: [], writeTeamId: DEFAULT_TEAM_ID, key: 'all' });

const scopeStorage = new AsyncLocalStorage();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function envAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

/* ---------- teams ---------- */

function listTeams() {
  const stored = store.peek().teams;
  const teams = (Array.isArray(stored) ? stored : [])
    .filter((team) => team && team.id && team.name)
    .map((team) => ({ id: String(team.id), name: String(team.name) }));
  if (!teams.some((team) => team.id === DEFAULT_TEAM_ID)) teams.unshift({ id: DEFAULT_TEAM_ID, name: DEFAULT_TEAM_NAME });
  return teams;
}

function findTeam(teamId) {
  return listTeams().find((team) => team.id === String(teamId || '')) || null;
}

function teamName(teamId) {
  const team = findTeam(teamId || DEFAULT_TEAM_ID);
  return team ? team.name : DEFAULT_TEAM_NAME;
}

function normalizeTeamName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('Team name is required.');
  if (value.length > 80) throw new Error('Team name must be 80 characters or fewer.');
  return value;
}

function assertUniqueTeamName(name, exceptId) {
  const clash = listTeams().find((team) => team.id !== exceptId && team.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`A team called ${clash.name} already exists.`);
}

async function addTeam(name) {
  const value = normalizeTeamName(name);
  assertUniqueTeamName(value);
  const config = store.snapshot();
  const team = { id: crypto.randomUUID(), name: value };
  config.teams = listTeams().concat(team);
  await store.save(config);
  return team;
}

async function renameTeam(teamId, name) {
  const value = normalizeTeamName(name);
  if (!findTeam(teamId)) throw new Error('That team no longer exists.');
  assertUniqueTeamName(value, teamId);
  const config = store.snapshot();
  config.teams = listTeams().map((team) => (team.id === teamId ? { ...team, name: value } : team));
  await store.save(config);
}

/**
 * Removes an empty team. Anything still pointing at it (members, people,
 * opportunities - the caller counts the last) has to be moved first, so
 * nothing silently falls into another team.
 */
async function removeTeam(teamId, { opportunityCount = 0 } = {}) {
  const team = findTeam(teamId);
  if (!team) throw new Error('That team no longer exists.');
  if (team.id === DEFAULT_TEAM_ID) throw new Error('The default team holds data from before teams existed and cannot be removed.');
  const members = listUsers().filter((user) => user.teamIds.includes(team.id)).length;
  const people = Object.values(personTeamMap()).filter((id) => id === team.id).length;
  if (members || people || opportunityCount) {
    const parts = [];
    if (members) parts.push(`${members} user${members === 1 ? '' : 's'}`);
    if (people) parts.push(`${people} ${people === 1 ? 'person' : 'people'}`);
    if (opportunityCount) parts.push(`${opportunityCount} opportunit${opportunityCount === 1 ? 'y' : 'ies'}`);
    throw new Error(`${team.name} still has ${parts.join(', ')}. Move or remove them first.`);
  }
  const config = store.snapshot();
  config.teams = listTeams().filter((entry) => entry.id !== team.id);
  if (config.teamJobTitles && typeof config.teamJobTitles === 'object') {
    config.teamJobTitles = { ...config.teamJobTitles };
    delete config.teamJobTitles[team.id];
  }
  await store.save(config);
}

/* ---------- roles (job titles) ---------- */

function jobTitleMap() {
  const stored = store.peek().teamJobTitles;
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * The roles people in a team pick from. The default team keeps the original
 * list until it saves its own; a new team starts empty and defines its own.
 */
function listJobTitles(teamId) {
  const id = String(teamId || DEFAULT_TEAM_ID);
  const stored = jobTitleMap()[id];
  if (Array.isArray(stored)) return stored.map((title) => String(title).trim()).filter(Boolean);
  return id === DEFAULT_TEAM_ID ? DEFAULT_JOB_TITLES.slice() : [];
}

function normalizeJobTitle(title) {
  const value = String(title || '').trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('Role name is required.');
  if (value.length > 80) throw new Error('Role name must be 80 characters or fewer.');
  return value;
}

async function writeJobTitles(teamId, titles) {
  const config = store.snapshot();
  config.teamJobTitles = { ...jobTitleMap(), [teamId]: titles };
  await store.save(config);
}

async function addJobTitle(teamId, title) {
  const team = findTeam(teamId);
  if (!team) throw new Error('Choose an existing team.');
  const value = normalizeJobTitle(title);
  const titles = listJobTitles(team.id);
  if (titles.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
    throw new Error(`${team.name} already has the role ${value}.`);
  }
  await writeJobTitles(team.id, titles.concat(value));
  return value;
}

/** People keep a removed role until someone picks another; it is only no longer offered. */
async function removeJobTitle(teamId, title) {
  const team = findTeam(teamId);
  if (!team) throw new Error('Choose an existing team.');
  const value = String(title || '').trim();
  const titles = listJobTitles(team.id);
  if (!titles.includes(value)) throw new Error(`${team.name} has no role ${value}.`);
  await writeJobTitles(team.id, titles.filter((existing) => existing !== value));
}

/* ---------- people's teams ---------- */

function personTeamMap() {
  const stored = store.peek().personTeams;
  return stored && typeof stored === 'object' ? stored : {};
}

/** The team a configured person belongs to; people from before teams are in the default one. */
function personTeam(personName) {
  const teamId = personTeamMap()[String(personName || '')];
  return teamId && findTeam(teamId) ? String(teamId) : DEFAULT_TEAM_ID;
}

/* ---------- users ---------- */

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (!ROLES.includes(value)) throw new Error(`Unknown role: ${role}`);
  return value;
}

/** A user's teams, oldest form first: `teamIds`, else the single `teamId` lists used to store. */
function storedTeamIds(user) {
  const raw = Array.isArray(user.teamIds) ? user.teamIds : user.teamId ? [user.teamId] : [];
  const ids = [...new Set(raw.map(String))].filter((id) => findTeam(id));
  return ids.length ? ids : [DEFAULT_TEAM_ID];
}

function listUsers() {
  const stored = store.peek().appUsers;
  return (Array.isArray(stored) ? stored : [])
    .filter((user) => user && user.email)
    .map((user) => {
      const teamIds = storedTeamIds(user);
      return {
        email: normalizeEmail(user.email),
        name: String(user.name || ''),
        role: ROLES.includes(user.role) ? user.role : 'member',
        teamIds,
        teamId: teamIds[0],
        addedAt: user.addedAt || null,
        addedBy: user.addedBy || '',
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

function findUser(email) {
  const key = normalizeEmail(email);
  return listUsers().find((user) => user.email === key) || null;
}

function adminCount(users) {
  return users.filter((user) => user.role === 'admin').length + envAdminEmails().filter((email) => !users.some((user) => user.email === email)).length;
}

function assertKeepsAnAdmin(users) {
  if (adminCount(users) === 0) throw new Error('At least one admin has to remain, or nobody could manage access.');
}

async function writeUsers(users) {
  const config = store.snapshot();
  config.appUsers = users;
  await store.save(config);
}

/** Adds someone to the allow-list, or updates them if they are already on it. */
async function saveUser({ email, name, role, teamIds, teamId }, addedBy) {
  const key = normalizeEmail(email);
  if (!key || !/^[^\s@]+@[^\s@]+$/.test(key)) throw new Error('A valid email address is required.');
  const nextRole = normalizeRole(role || 'member');
  const requested = [].concat(teamIds === undefined ? teamId || DEFAULT_TEAM_ID : teamIds).map((id) => String(id || '')).filter(Boolean);
  if (!requested.length) throw new Error('Pick at least one team.');
  if (requested.some((id) => !findTeam(id))) throw new Error('Choose an existing team.');

  const users = listUsers();
  const existing = users.find((user) => user.email === key);
  const entry = {
    email: key,
    name: String(name === undefined ? (existing && existing.name) || '' : name).trim().slice(0, 120),
    role: nextRole,
    teamIds: [...new Set(requested)],
    addedAt: (existing && existing.addedAt) || new Date().toISOString(),
    addedBy: (existing && existing.addedBy) || normalizeEmail(addedBy),
  };
  const next = existing ? users.map((user) => (user.email === key ? entry : user)) : users.concat(entry);
  assertKeepsAnAdmin(next);
  await writeUsers(next.map(({ teamId: _primary, ...user }) => user));
  return { user: entry, created: !existing };
}

async function removeUser(email) {
  const key = normalizeEmail(email);
  const users = listUsers();
  if (!users.some((user) => user.email === key)) throw new Error('That user is not on the list.');
  const next = users.filter((user) => user.email !== key);
  assertKeepsAnAdmin(next);
  await writeUsers(next.map(({ teamId: _primary, ...user }) => user));
}

/* ---------- resolving a request ---------- */

/**
 * What the signed-in person may do: { allowed, role, teamIds, teamId, email }.
 * Nobody signed in only happens outside production (production requires
 * sign-in), where the local developer gets full access.
 */
function resolveAccess(user) {
  if (!user) {
    if (process.env.NODE_ENV === 'production') return { allowed: false, reason: 'signed-out' };
    return { allowed: true, role: 'admin', teamIds: [DEFAULT_TEAM_ID], teamId: DEFAULT_TEAM_ID, email: '', local: true };
  }
  const email = normalizeEmail(user.email || user.id);
  const listed = listUsers().find((entry) => entry.email === email);
  const envAdmin = envAdminEmails().includes(email);

  if (listed) return { allowed: true, role: envAdmin ? 'admin' : listed.role, teamIds: listed.teamIds, teamId: listed.teamId, email };
  if (envAdmin) return { allowed: true, role: 'admin', teamIds: [DEFAULT_TEAM_ID], teamId: DEFAULT_TEAM_ID, email };
  return { allowed: false, reason: 'not-listed', email };
}

function accessTeamIds(access) {
  const ids = Array.isArray(access.teamIds) && access.teamIds.length ? access.teamIds : [access.teamId || DEFAULT_TEAM_ID];
  return ids.map(String);
}

/** The teams someone may look at and file work under: every team for admins, their own otherwise. */
function teamsFor(access) {
  if (access.role === 'admin') return listTeams();
  const ids = accessTeamIds(access);
  const teams = listTeams().filter((team) => ids.includes(team.id));
  return teams.length ? teams : listTeams().filter((team) => team.id === DEFAULT_TEAM_ID);
}

/**
 * The data a request may touch. Admins look at every team unless they picked
 * one; members look at all of their teams unless they picked one of those.
 * New work goes to the team being looked at, or the person's first team.
 */
function buildScope(access, viewTeamId) {
  const own = accessTeamIds(access);
  if (access.role === 'admin') {
    const viewing = viewTeamId && findTeam(viewTeamId) ? String(viewTeamId) : '';
    if (!viewing) return { all: true, teamId: null, teamIds: [], writeTeamId: own[0], key: 'all' };
    return { all: false, teamId: viewing, teamIds: [viewing], writeTeamId: viewing, key: `team:${viewing}` };
  }
  const teamIds = teamsFor(access).map((team) => team.id);
  const viewing = viewTeamId && teamIds.includes(String(viewTeamId)) ? String(viewTeamId) : '';
  const ids = viewing ? [viewing] : teamIds;
  return {
    all: false,
    teamId: ids.length === 1 ? ids[0] : null,
    teamIds: ids,
    writeTeamId: ids[0],
    key: `team:${ids.join(',')}`,
  };
}

function runWithScope(scope, fn) {
  return scopeStorage.run(scope, fn);
}

function currentScope() {
  return scopeStorage.getStore() || UNRESTRICTED;
}

/** True when the current request may see something filed under `teamId`. */
function teamVisible(teamId) {
  const scope = currentScope();
  return scope.all || scope.teamIds.includes(teamId || DEFAULT_TEAM_ID);
}

/**
 * Appends the team restriction for a query over dbo.Opportunities. `column` is
 * the TeamId column as the query names it (e.g. 'o.TeamId'). Rows without a
 * team are the default team's.
 */
function teamFilterSql(request, column, sqlType) {
  const scope = currentScope();
  if (scope.all) return '';
  if (scope.teamIds.length === 1) {
    request.input('scopeTeamId', sqlType, scope.teamIds[0]);
    return ` AND COALESCE(${column}, '${DEFAULT_TEAM_ID}') = @scopeTeamId`;
  }
  const names = scope.teamIds.map((id, index) => {
    request.input(`scopeTeamId${index}`, sqlType, id);
    return `@scopeTeamId${index}`;
  });
  return ` AND COALESCE(${column}, '${DEFAULT_TEAM_ID}') IN (${names.join(', ')})`;
}

module.exports = {
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_NAME,
  ROLES,
  normalizeEmail,
  envAdminEmails,
  listTeams,
  findTeam,
  teamName,
  addTeam,
  renameTeam,
  removeTeam,
  DEFAULT_JOB_TITLES,
  listJobTitles,
  addJobTitle,
  removeJobTitle,
  personTeamMap,
  personTeam,
  listUsers,
  findUser,
  saveUser,
  removeUser,
  resolveAccess,
  teamsFor,
  buildScope,
  runWithScope,
  currentScope,
  teamVisible,
  teamFilterSql,
};
