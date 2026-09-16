const { getConfig, updatePeopleConfig } = require('../config/settings');
const { HOURS_PER_DAY, round2 } = require('./dateService');

/** Roles offered in the person configuration, most junior first. */
const PERSON_ROLES = [
  'Associate Expert Data Intelligence',
  'Expert Data Intelligence',
  'Sr Expert Data Intelligence',
  'Lead Expert Data Intelligence',
];

const COST_CURRENCY = 'CHF';

function listPeople() {
  return [...new Set(getConfig().people.names.map((name) => String(name).trim()).filter(Boolean))];
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

function getManagerMap() {
  return { ...getConfig().people.managers };
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
  const people = listPeople();
  if (!people.includes(name)) people.push(name);

  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();
  const managerMap = getManagerMap();

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

  updatePeopleConfig({ people, personDailyHours: dailyHoursMap, personRoles: roleMap, personCosts: costMap, personManagers: managerMap });
}

function addPerson(personName, dailyHours, role, cost, manager) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
  });
}

function removePerson(personName) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  const people = listPeople().filter((person) => person !== name);
  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();
  const managerMap = getManagerMap();
  const absenceMap = getAbsenceMap();
  delete dailyHoursMap[name];
  delete roleMap[name];
  delete costMap[name];
  delete managerMap[name];
  delete absenceMap[name];

  updatePeopleConfig({
    people,
    personDailyHours: dailyHoursMap,
    personRoles: roleMap,
    personCosts: costMap,
    personManagers: managerMap,
    personAbsences: absenceMap,
  });
}

/** Saves the editable columns of a configured person in one go. */
function updatePersonProfile(personName, { dailyHours, role, cost, manager }) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
    manager: normalizeManager(manager),
  });
}

function updateDailyHours(personName, dailyHours) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');
  writePerson(name, { dailyHours: normalizeDailyHours(dailyHours) });
}

module.exports = {
  PERSON_ROLES,
  COST_CURRENCY,
  listPeople,
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
