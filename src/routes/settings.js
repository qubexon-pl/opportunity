const express = require('express');
const {
  PERSON_ROLES,
  COST_CURRENCY,
  listPeople,
  listManagers,
  getPersonDailyHours,
  getPersonRole,
  getPersonCost,
  getPersonManager,
  addPerson,
  removePerson,
  updatePersonProfile,
} = require('../services/peopleService');
const { HOURS_PER_DAY, MONTHLY_CAPACITY } = require('../services/dateService');
const { ABSENCE_KINDS, listAbsences, addAbsence, updateAbsence, removeAbsence } = require('../services/absenceService');
const { STAGES } = require('../services/opportunityService');
const { listFirmStages } = require('../services/bookingService');
const { updateFirmStages } = require('../config/settings');

const router = express.Router();

router.get('/', (req, res) => {
  const people = listPeople().map((person) => {
    const absences = listAbsences(person);
    return {
      name: person,
      dailyHours: getPersonDailyHours(person),
      role: getPersonRole(person),
      cost: getPersonCost(person),
      manager: getPersonManager(person),
      absences,
      absenceDays: absences.reduce((total, absence) => total + absence.businessDays, 0),
    };
  });

  res.render('settings', {
    title: 'Configuration',
    people,
    personRoles: PERSON_ROLES,
    managerOptions: listManagers(),
    absenceKinds: ABSENCE_KINDS,
    costCurrency: COST_CURRENCY,
    defaultDailyHours: HOURS_PER_DAY,
    monthlyCapacity: MONTHLY_CAPACITY,
    stages: STAGES,
    firmStages: listFirmStages(),
    openPerson: String(req.query.person || ''),
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
    addPerson(req.body.personName, req.body.dailyHours, req.body.role, req.body.internalCost, req.body.manager);
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
      manager: req.body.manager,
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

/** Absence removes working days from a person's capacity for the dates it covers. */
router.post('/people/absences', (req, res) => {
  const person = String(req.body.personName || '').trim();
  const redirectTo = String(req.body.redirect || '');
  try {
    const absence = addAbsence(person, {
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      kind: req.body.kind,
      note: req.body.note,
    });
    req.flash(
      'success',
      `${absence.kind} recorded for ${person}: ${absence.startDate} to ${absence.endDate}. Their capacity drops for that period.`
    );
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(redirectTo || `/settings?person=${encodeURIComponent(person)}`);
});

router.post('/people/absences/remove', (req, res) => {
  const person = String(req.body.personName || '').trim();
  const redirectTo = String(req.body.redirect || '');
  try {
    removeAbsence(person, req.body.absenceId);
    req.flash('success', `Absence removed. ${person} is available again for those dates.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(redirectTo || `/settings?person=${encodeURIComponent(person)}`);
});

router.post('/people/absences/update', (req, res) => {
  const person = String(req.body.personName || '').trim();
  const redirectTo = String(req.body.redirect || '');
  try {
    const updated = updateAbsence(person, req.body.absenceId, {
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      kind: req.body.kind,
      note: req.body.note,
    });
    req.flash('success', `Absence updated for ${person}: ${updated.startDate} to ${updated.endDate}.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(redirectTo || `/settings?person=${encodeURIComponent(person)}`);
});

module.exports = router;
