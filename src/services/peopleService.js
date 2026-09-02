const { getConfig, updatePeopleConfig } = require('../config/settings');
const { HOURS_PER_DAY } = require('./dateService');

function listPeople() {
  return [...new Set(getConfig().people.names.map((name) => String(name).trim()).filter(Boolean))];
}

function getDailyHoursMap() {
  return { ...getConfig().people.dailyHours };
}

function getPersonDailyHours(personName) {
  const configured = Number(getConfig().people.dailyHours[personName]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return HOURS_PER_DAY;
}

function addPerson(personName, dailyHours) {
  const name = String(personName || '').trim();
  const hours = Number(dailyHours);
  if (!name) throw new Error('Person name is required.');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error('Daily hours must be between 0 and 24.');
  }

  const people = listPeople();
  if (!people.includes(name)) people.push(name);

  const dailyHoursMap = getDailyHoursMap();
  dailyHoursMap[name] = hours;

  updatePeopleConfig({ people, personDailyHours: dailyHoursMap });
}

function removePerson(personName) {
  const name = String(personName || '').trim();
  if (!name) throw new Error('Person name is required.');

  const people = listPeople().filter((person) => person !== name);
  const dailyHoursMap = getDailyHoursMap();
  delete dailyHoursMap[name];

  updatePeopleConfig({ people, personDailyHours: dailyHoursMap });
}

function updateDailyHours(personName, dailyHours) {
  const name = String(personName || '').trim();
  const hours = Number(dailyHours);
  if (!name) throw new Error('Person name is required.');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error('Daily hours must be between 0 and 24.');
  }

  const dailyHoursMap = getDailyHoursMap();
  dailyHoursMap[name] = hours;
  updatePeopleConfig({ people: listPeople(), personDailyHours: dailyHoursMap });
}

module.exports = {
  listPeople,
  getDailyHoursMap,
  getPersonDailyHours,
  addPerson,
  removePerson,
  updateDailyHours,
};
