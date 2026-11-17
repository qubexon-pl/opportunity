const { getConfig, updatePeopleConfig } = require('../config/settings');
const { HOURS_PER_DAY, round2 } = require('./dateService');
const { currentScope, personTeam, personTeamMap, findTeam, teamVisible } = require('./accessService');

/** Roles offered in the person configuration, most junior first. */
const PERSON_ROLES = [
  'Associate Expert Data Intelligence',
  'Expert Data Intelligence',
  'Sr Expert Data Intelligence',
  'Lead Expert Data Intelligence',
];

const COST_CURRENCY = 'CHF';

/** Every configured person, whichever team they are in. */
function listAllPeople() {
  return [...new Set(getConfig().people.names.map((name) => String(name).trim()).filter(Boolean))];
}

/** The people the current request may see: its team's, or everyone's for an admin looking at all teams. */
function listPeople() {
  const all = listAllPeople();
  if (currentScope().all) return all;
  return all.filter((name) => teamVisible(personTeam(name)));
}

/** Refuses to touch someone outside the current team, as if they did not exist. */
function assertPersonVisible(name) {
  if (!listPeople().includes(name)) throw new Error(`${name} is not in this team.`);
}

function getDailyHoursMap() {
  return { ...getConfig().people.dailyHours };
}

function getRoleMap() {
  return { ...getConfig().people.roles };
}

function getCostMap() {
  return { ...getConfig().people.costs };
}

/** Managers of the people in view only, so another team's managers never show up as filter options. */
function getManagerMap() {
  const visible = new Set(listPeople());
  const map = {};
  Object.entries(getConfig().people.managers).forEach(([person, manager]) => {
    if (visible.has(person)) map[person] = manager;
  });
  return map;
}

/** Raw absence store, used when removing a person so their entries go with them. */
function getAbsenceMap() {
  return { ...getConfig().people.absences };
}

function getPersonDailyHours(personName) {
  const configured = Number(getConfig().people.dailyHours[personName]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return HOURS_PER_DAY;
}

/** An unset or unrecognised role reads back as empty rather than guessing. */
function getPersonRole(personName) {
  const role = String(getConfig().people.roles[personName] || '').trim();
  return PERSON_ROLES.includes(role) ? role : '';
}

function getPersonCost(personName) {
  const cost = Number(getConfig().people.costs[personName]);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

function getPersonManager(personName) {
  return String(getConfig().people.managers[personName] || '').trim();
}

/** Returns a list of unique manager names from the managers map. */
function listManagers() {
  return [...new Set(Object.values(getManagerMap()).map((m) => String(m).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeDailyHours(dailyHours) {
  const hours = Number(dailyHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error('Daily hours must be between 0 and 24.');
  }
  return hours;
}

/** An empty role clears it; anything unrecognised is rejected rather than stored. */
function normalizeRole(role) {
  const value = String(role ?? '').trim();
  if (!value) return '';
  if (!PERSON_ROLES.includes(value)) throw new Error(`Unknown role: ${value}`);
  return value;
}

/** An empty cost clears it; otherwise it must be a non-negative number. */
function normalizeCost(cost) {
  if (cost === undefined || cost === null || String(cost).trim() === '') return null;
  const value = Number(cost);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Internal cost must be a positive ${COST_CURRENCY} amount.`);
  return round2(value);
}

/** An empty manager clears it; otherwise it's stored as a trimmed string. */
function normalizeManager(manager) {
  const value = String(manager ?? '').trim();
  return value || '';
}

function writePerson(name, { dailyHours, role, cost, manager }) {
  // Written back whole, so these are everyone's, not just the team in view.
  const people = listAllPeople();
  const personTeams = { ...personTeamMap() };
  if (!people.includes(name)) {
    people.push(name);
    personTeams[name] = currentScope().writeTeamId;
  }

  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();
  const managerMap = { ...getConfig().people.managers };

  if (dailyHours !== undefined) dailyHoursMap[name] = dailyHours;
  if (role !== undefined) {
    if (role) roleMap[name] = role;
    else delete roleMap[name];
  }
  if (cost !== undefined) {
    if (cost === null) delete costMap[name];
    else costMap[name] = cost;
  }
  if (manager !== undefined) {
    if (manager) managerMap[name] = manager;
    else delete managerMap[name];
  }

  return updatePeopleConfig({
    people,
    personDailyHours: dailyHoursMap,
    personRoles: roleMap,
    personCosts: costMap,
    personManagers: managerMap,
    personTeams,
  });
}

async function addPerson(personName, dailyHours, role, cost, manager) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  // Assignments refer to people by name, so a name is unique across teams.
  if (listAllPeople().includes(name) && !listPeople().includes(name)) {
    throw new Error(`${name} is already set up in another team. Use a distinguishing name, or ask an admin to move them.`);
  }

  return writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
  });
}

async function removePerson(personName) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  assertPersonVisible(name);

  const people = listAllPeople().filter((person) => person !== name);
  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();
  const managerMap = { ...getConfig().people.managers };
  const absenceMap = getAbsenceMap();
  const personTeams = { ...personTeamMap() };
  delete personTeams[name];
  delete dailyHoursMap[name];
  delete roleMap[name];
  delete costMap[name];
  delete managerMap[name];
  delete absenceMap[name];

  return updatePeopleConfig({
    people,
    personDailyHours: dailyHoursMap,
    personRoles: roleMap,
    personCosts: costMap,
    personManagers: managerMap,
    personAbsences: absenceMap,
    personTeams,
  });
}

/** Saves the editable columns of a configured person in one go. */
async function updatePersonProfile(personName, { dailyHours, role, cost, manager }) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  assertPersonVisible(name);

  return writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
  });
}

async function updateDailyHours(personName, dailyHours) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  assertPersonVisible(name);
  return writePerson(name, { dailyHours: normalizeDailyHours(dailyHours) });
}

/** Admin only: hands a person, with their settings and absences, to another team. */
async function movePersonToTeam(personName, teamId) {
  const name = String(personName || '').trim();
  if (!listAllPeople().includes(name)) throw new Error(`${name || 'That person'} is not configured.`);
  const team = findTeam(teamId);
  if (!team) throw new Error('Choose an existing team.');
  return updatePeopleConfig({ personTeams: { ...personTeamMap(), [name]: team.id } });
}

module.exports = {
  PERSON_ROLES,
  COST_CURRENCY,
  listPeople,
  listAllPeople,
  assertPersonVisible,
  movePersonToTeam,
  listManagers,
  getDailyHoursMap,
  getRoleMap,
  getCostMap,
  getManagerMap,
  getPersonDailyHours,
  getPersonRole,
  getPersonCost,
  getPersonManager,
  addPerson,
  removePerson,
  updatePersonProfile,
  updateDailyHours,
};
