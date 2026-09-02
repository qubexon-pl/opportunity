const express = require('express');
const {
  PERSON_ROLES,
  COST_CURRENCY,
  listPeople,
  getPersonDailyHours,
  getPersonRole,
  getPersonCost,
  addPerson,
  removePerson,
  updatePersonProfile,
} = require('../services/peopleService');
const { HOURS_PER_DAY, MONTHLY_CAPACITY } = require('../services/dateService');
const { STAGES } = require('../services/opportunityService');
const { listFirmStages } = require('../services/bookingService');
const { updateFirmStages } = require('../config/settings');

const router = express.Router();

router.get('/', (req, res) => {
  const people = listPeople().map((person) => ({
    name: person,
    dailyHours: getPersonDailyHours(person),
    role: getPersonRole(person),
    cost: getPersonCost(person),
  }));

  res.render('settings', {
    title: 'Configuration',
    people,
    personRoles: PERSON_ROLES,
    costCurrency: COST_CURRENCY,
    defaultDailyHours: HOURS_PER_DAY,
    monthlyCapacity: MONTHLY_CAPACITY,
    stages: STAGES,
    firmStages: listFirmStages(),
  });
});

/** Chooses which stages consume real capacity; every other stage is a soft booking. */
router.post('/capacity/stages', (req, res) => {
  try {
    const raw = req.body.firmStages;
    const selected = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    const valid = selected.filter((stage) => STAGES.includes(String(stage)));
    updateFirmStages(valid);
    req.flash('success', valid.length ? `Committed stages: ${valid.join(', ')}.` : 'All stages are now soft bookings.');
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/settings');
});

router.post('/people', (req, res) => {
  try {
    addPerson(req.body.personName, req.body.dailyHours, req.body.role, req.body.internalCost);
    req.flash('success', `${String(req.body.personName).trim()} added.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/settings');
});

router.post('/people/profile', (req, res) => {
  try {
    updatePersonProfile(req.body.personName, {
      dailyHours: req.body.dailyHours,
      role: req.body.role,
      cost: req.body.internalCost,
    });
    req.flash('success', `${String(req.body.personName).trim()} updated.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/settings');
});

router.post('/people/remove', (req, res) => {
  try {
    removePerson(req.body.personName);
    req.flash('success', `${String(req.body.personName).trim()} removed.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/settings');
});

module.exports = router;
