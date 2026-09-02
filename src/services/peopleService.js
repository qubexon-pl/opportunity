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

function writePerson(name, { dailyHours, role, cost }) {
  const people = listPeople();
  if (!people.includes(name)) people.push(name);

  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();

  if (dailyHours !== undefined) dailyHoursMap[name] = dailyHours;
  if (role !== undefined) {
    if (role) roleMap[name] = role;
    else delete roleMap[name];
  }
  if (cost !== undefined) {
    if (cost === null) delete costMap[name];
    else costMap[name] = cost;
  }

  updatePeopleConfig({ people, personDailyHours: dailyHoursMap, personRoles: roleMap, personCosts: costMap });
}

function addPerson(personName, dailyHours, role, cost) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
  });
}

function removePerson(personName) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  const people = listPeople().filter((person) => person !== name);
  const dailyHoursMap = getDailyHoursMap();
  const roleMap = getRoleMap();
  const costMap = getCostMap();
  const absenceMap = getAbsenceMap();
  delete dailyHoursMap[name];
  delete roleMap[name];
  delete costMap[name];
  delete absenceMap[name];

  updatePeopleConfig({
    people,
    personDailyHours: dailyHoursMap,
    personRoles: roleMap,
    personCosts: costMap,
    personAbsences: absenceMap,
  });
}

/** Saves the editable columns of a configured person in one go. */
function updatePersonProfile(personName, { dailyHours, role, cost }) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  writePerson(name, {
    dailyHours: normalizeDailyHours(dailyHours),
    role: normalizeRole(role),
    cost: normalizeCost(cost),
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
  getDailyHoursMap,
  getRoleMap,
  getCostMap,
  getPersonDailyHours,
  getPersonRole,
  getPersonCost,
  addPerson,
  removePerson,
  updatePersonProfile,
  updateDailyHours,
};
