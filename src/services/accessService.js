/**
 * Who may use the app, and which team's data they see.
 *
 * Access is an allow-list kept with the other settings (dbo.AppSettings, or
 * config.local.json without a database):
 *
 *   appUsers  [{ email, name, role: 'admin' | 'member', teamId, addedAt, addedBy }]
 *   teams     [{ id, name }]
 *
 * A member sees and edits only their own team: the people configured for it,
 * the opportunities created in it and everything hanging off those
 * (assignments, notes, next steps, absences). An admin sees every team, can
 * narrow the view to one, and manages the allow-list and the teams.
 *
 * Bootstrapping: emails in ADMIN_EMAILS (comma separated) are always admins.
 * Without that setting, the first person to sign in while the allow-list is
 * empty becomes its first admin, so a fresh deployment cannot lock everyone out.
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

const UNRESTRICTED = Object.freeze({ all: true, teamId: null, writeTeamId: DEFAULT_TEAM_ID, key: 'all' });

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
  const members = listUsers().filter((user) => user.teamId === team.id).length;
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
  await store.save(config);
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

function listUsers() {
  const stored = store.peek().appUsers;
  return (Array.isArray(stored) ? stored : [])
    .filter((user) => user && user.email)
    .map((user) => ({
      email: normalizeEmail(user.email),
      name: String(user.name || ''),
      role: ROLES.includes(user.role) ? user.role : 'member',
      teamId: user.teamId && findTeam(user.teamId) ? String(user.teamId) : DEFAULT_TEAM_ID,
      addedAt: user.addedAt || null,
      addedBy: user.addedBy || '',
    }))
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
async function saveUser({ email, name, role, teamId }, addedBy) {
  const key = normalizeEmail(email);
  if (!key || !/^[^\s@]+@[^\s@]+$/.test(key)) throw new Error('A valid email address is required.');
  const nextRole = normalizeRole(role || 'member');
  const team = findTeam(teamId || DEFAULT_TEAM_ID);
  if (!team) throw new Error('Choose an existing team.');

  const users = listUsers();
  const existing = users.find((user) => user.email === key);
  const entry = {
    email: key,
    name: String(name === undefined ? (existing && existing.name) || '' : name).trim().slice(0, 120),
    role: nextRole,
    teamId: team.id,
    addedAt: (existing && existing.addedAt) || new Date().toISOString(),
    addedBy: (existing && existing.addedBy) || normalizeEmail(addedBy),
  };
  const next = existing ? users.map((user) => (user.email === key ? entry : user)) : users.concat(entry);
  assertKeepsAnAdmin(next);
  await writeUsers(next);
  return { user: entry, created: !existing };
}

async function removeUser(email) {
  const key = normalizeEmail(email);
  const users = listUsers();
  if (!users.some((user) => user.email === key)) throw new Error('That user is not on the list.');
  const next = users.filter((user) => user.email !== key);
  assertKeepsAnAdmin(next);
  await writeUsers(next);
}

/* ---------- resolving a request ---------- */

/**
 * What the signed-in person may do: { allowed, role, teamId, email, bootstrap }.
 * Nobody signed in only happens outside production (production requires
 * sign-in), where the local developer gets full access.
 */
function resolveAccess(user) {
  if (!user) {
    if (process.env.NODE_ENV === 'production') return { allowed: false, reason: 'signed-out' };
    return { allowed: true, role: 'admin', teamId: DEFAULT_TEAM_ID, email: '', local: true };
  }
  const email = normalizeEmail(user.email || user.id);
  const users = listUsers();
  const listed = users.find((entry) => entry.email === email);
  const envAdmin = envAdminEmails().includes(email);

  if (listed) return { allowed: true, role: envAdmin ? 'admin' : listed.role, teamId: listed.teamId, email };
  if (envAdmin) return { allowed: true, role: 'admin', teamId: DEFAULT_TEAM_ID, email };
  if (!users.length && !envAdminEmails().length) {
    return { allowed: true, role: 'admin', teamId: DEFAULT_TEAM_ID, email, bootstrap: true };
  }
  return { allowed: false, reason: 'not-listed', email };
}

/**
 * The data a request may touch. Admins look at every team unless they picked
 * one; what they create goes to the team they are looking at, or their own.
 */
function buildScope(access, viewTeamId) {
  if (access.role === 'admin') {
    const viewing = viewTeamId && findTeam(viewTeamId) ? String(viewTeamId) : '';
    if (!viewing) return { all: true, teamId: null, writeTeamId: access.teamId || DEFAULT_TEAM_ID, key: 'all' };
    return { all: false, teamId: viewing, writeTeamId: viewing, key: `team:${viewing}` };
  }
  const teamId = access.teamId || DEFAULT_TEAM_ID;
  return { all: false, teamId, writeTeamId: teamId, key: `team:${teamId}` };
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
  return scope.all || (teamId || DEFAULT_TEAM_ID) === scope.teamId;
}

/**
 * Appends the team restriction for a query over dbo.Opportunities. `column` is
 * the TeamId column as the query names it (e.g. 'o.TeamId'). Rows without a
 * team are the default team's.
 */
function teamFilterSql(request, column, sqlType) {
  const scope = currentScope();
  if (scope.all) return '';
  request.input('scopeTeamId', sqlType, scope.teamId);
  return ` AND COALESCE(${column}, '${DEFAULT_TEAM_ID}') = @scopeTeamId`;
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
  personTeamMap,
  personTeam,
  listUsers,
  findUser,
  saveUser,
  removeUser,
  resolveAccess,
  buildScope,
  runWithScope,
  currentScope,
  teamVisible,
  teamFilterSql,
};
