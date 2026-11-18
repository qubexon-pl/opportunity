const { getConfig, updatePeopleConfig } = require('../config/settings');
const { HOURS_PER_DAY, round2 } = require('./dateService');
const { currentScope, personTeam, personTeamMap, findTeam, teamVisible, listJobTitles } = require('./accessService');

const COST_CURRENCY = 'CHF';
/* The share of capacity a person is expected to bill when no target is set. */
const DEFAULT_CHARGEABILITY_TARGET = 75;

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

/** The role as stored; one an admin has since removed from the team's list still reads back. */
function getPersonRole(personName) {
  return String(getConfig().people.roles[personName] || '').trim();
}

/** Roles a person can be given: their team's list, plus the one they hold if it was removed since. */
function roleOptionsFor(personName) {
  const options = listJobTitles(personTeam(personName));
  const current = getPersonRole(personName);
  return current && !options.includes(current) ? options.concat(current) : options;
}

function getPersonCost(personName) {
  const cost = Number(getConfig().people.costs[personName]);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** The chargeability a person is expected to reach, in percent of their capacity. */
function getPersonChargeabilityTarget(personName) {
  const stored = getConfig().people.chargeabilityTargets[personName];
  const value = Number(stored);
  return stored !== undefined && stored !== null && stored !== '' && Number.isFinite(value) ? value : DEFAULT_CHARGEABILITY_TARGET;
}

/** Whether a target was set for this person, as opposed to the default. */
function hasPersonChargeabilityTarget(personName) {
  return Object.prototype.hasOwnProperty.call(getConfig().people.chargeabilityTargets, personName);
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

/** An empty role clears it; otherwise it must be one of `allowed`, so typos never get stored. */
function normalizeRole(role, allowed) {
  const value = String(role ?? '').trim();
  if (!value) return '';
  if (!allowed.includes(value)) throw new Error(`Unknown role: ${value}. Admins add roles in Admin → Roles.`);
  return value;
}

/** An empty cost clears it; otherwise it must be a non-negative number. */
function normalizeCost(cost) {
  if (cost === undefined || cost === null || String(cost).trim() === '') return null;
  const value = Number(cost);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Internal cost must be a positive ${COST_CURRENCY} amount.`);
  return round2(value);
}

/** An empty target clears it (the default applies); otherwise 0-100 percent. */
function normalizeChargeabilityTarget(target) {
  if (target === undefined || target === null || String(target).trim() === '') return null;
  const value = Number(target);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Chargeability target must be between 0 and 100%.');
  return round2(value);
}

/** An empty manager clears it; otherwise it's stored as a trimmed string. */
function normalizeManager(manager) {
  const value = String(manager ?? '').trim();
  return value || '';
}

function writePerson(name, { dailyHours, role, cost, manager, target }) {
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
  const targetMap = { ...getConfig().people.chargeabilityTargets };

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
  if (target !== undefined) {
    if (target === null) delete targetMap[name];
    else targetMap[name] = target;
  }

  return updatePeopleConfig({
    people,
    personDailyHours: dailyHoursMap,
    personRoles: roleMap,
    personCosts: costMap,
    personManagers: managerMap,
    personChargeabilityTargets: targetMap,
    personTeams,
  });
}

async function addPerson(personName, dailyHours, role, cost, manager, target) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  // Assignments refer to people by name, so a name is unique across teams.
  if (listAllPeople().includes(name) && !listPeople().includes(name)) {
    throw new Error(`${name} is already set up in another team. Use a distinguishing name, or ask an admin to move them.`);
  }

  return writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role, listJobTitles(currentScope().writeTeamId)),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
    target: normalizeChargeabilityTarget(target),
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
  const targetMap = { ...getConfig().people.chargeabilityTargets };
  const personTeams = { ...personTeamMap() };
  delete personTeams[name];
  delete targetMap[name];
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
    personChargeabilityTargets: targetMap,
    personTeams,
  });
}

/** Saves the editable columns of a configured person in one go. */
async function updatePersonProfile(personName, { dailyHours, role, cost, manager, target }) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  assertPersonVisible(name);

  return writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role, roleOptionsFor(name)),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
    target: target === undefined ? undefined : normalizeChargeabilityTarget(target),
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
  COST_CURRENCY,
  DEFAULT_CHARGEABILITY_TARGET,
  getPersonChargeabilityTarget,
  hasPersonChargeabilityTarget,
  roleOptionsFor,
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
