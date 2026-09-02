const express = require('express');
const { listPeople, getPersonDailyHours, addPerson, removePerson, updateDailyHours } = require('../services/peopleService');
const { HOURS_PER_DAY, MONTHLY_CAPACITY } = require('../services/dateService');

const router = express.Router();

router.get('/', (req, res) => {
  const people = listPeople().map((person) => ({
    name: person,
    dailyHours: getPersonDailyHours(person),
  }));

  res.render('settings', {
    title: 'Configuration',
    people,
    defaultDailyHours: HOURS_PER_DAY,
    monthlyCapacity: MONTHLY_CAPACITY,
  });
});

router.post('/people', (req, res) => {
  try {
    addPerson(req.body.personName, req.body.dailyHours);
    req.flash('success', `${String(req.body.personName).trim()} added.`);
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect('/settings');
});

router.post('/people/hours', (req, res) => {
  try {
    updateDailyHours(req.body.personName, req.body.dailyHours);
    req.flash('success', 'Daily capacity updated.');
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
