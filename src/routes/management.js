const express = require('express');
const { listOpportunities } = require('../services/opportunityService');
const { listAssignments, addAssignment, updateAssignment } = require('../services/assignmentService');
const { listPeople } = require('../services/peopleService');
const {
  MONTHLY_CAPACITY,
  toDateText,
} = require('../services/dateService');
const {
  TIMELINE_UNIT_OPTIONS,
  STAGE_LEGEND,
  HOURS_PER_DAY,
  buildManagementView,
  stageStatusLabel,
  stageAccentClass,
  capacityClass,
} = require('../services/capacityService');
const { listFirmStages } = require('../services/bookingService');
const { getViewDefaults, updateViewDefaults } = require('../config/settings');
const { queryList, filterAgainst } = require('../services/filterService');
const { STAGES } = require('../services/opportunityService');
const { isDatabaseUnavailable } = require('../db/pool');

const router = express.Router();

/** Stage options for the timeline filter, plus the "free capacity" pseudo-stage. */
const TIMELINE_FILTER_OPTIONS = [...STAGES, 'free'];

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePerspective(value, fallback) {
  const key = String(value || '');
  if (TIMELINE_UNIT_OPTIONS.some((option) => option.key === key)) return key;
  return TIMELINE_UNIT_OPTIONS.some((option) => option.key === fallback) ? fallback : 'months';
}

function normalizeUnits(value, fallback) {
  return Math.min(24, Math.max(1, num(value) || fallback || 6));
}

router.get('/', async (req, res, next) => {
  const defaults = getViewDefaults().management;

  const applied = req.query.applied === '1';
  const perspective = normalizePerspective(
    req.query.perspective === undefined ? defaults.perspective : req.query.perspective,
    defaults.perspective
  );
  const unitsToShow = normalizeUnits(req.query.units === undefined ? defaults.units : req.query.units, defaults.units);
  const stageFilters = applied
    ? filterAgainst(queryList(req.query.stage), TIMELINE_FILTER_OPTIONS)
    : filterAgainst(defaults.stages, TIMELINE_FILTER_OPTIONS);

  try {
    let loadError = null;
    let opportunities = [];
    let assignments = [];

    try {
      [opportunities, assignments] = await Promise.all([
        listOpportunities({ sort: 'name', dir: 'asc' }),
        listAssignments({ includeHidden: true }),
      ]);
    } catch (err) {
      if (!isDatabaseUnavailable(err)) throw err;
      loadError = err.message || String(err);
    }

    const view = buildManagementView({ opportunities, assignments, perspective, unitsToShow, stageFilter: stageFilters });

    const sameStages = JSON.stringify([...stageFilters].sort()) === JSON.stringify([...defaults.stages].sort());

    res.render('management', {
      title: 'Team capacity',
      monthlyCapacity: MONTHLY_CAPACITY,
      hoursPerDay: HOURS_PER_DAY,
      perspective,
      unitsToShow,
      stageFilters,
      timelineFilterOptions: TIMELINE_FILTER_OPTIONS,
      timelineUnitOptions: TIMELINE_UNIT_OPTIONS,
      stageLegend: STAGE_LEGEND,
      people: listPeople(),
      projects: opportunities,
      view,
      firmStages: listFirmStages(),
      savedDefaults: defaults,
      filtersMatchDefault: sameStages && perspective === defaults.perspective && unitsToShow === defaults.units,
      loadError,
      stageStatusLabel,
      stageAccentClass,
      capacityClass,
      toDateText,
      today: toDateText(new Date()),
    });
  } catch (err) {
    next(err);
  }
});

/** Remembers the current timeline filter as the management default. */
router.post('/defaults', (req, res) => {
  try {
    updateViewDefaults('management', {
      stages: filterAgainst(queryList(req.body.stage), TIMELINE_FILTER_OPTIONS),
      perspective: normalizePerspective(req.body.perspective, 'months'),
      units: normalizeUnits(req.body.units, 6),
    });
    req.flash('success', 'Saved as your default timeline view.');
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(req.get('referer') || '/management');
});

router.post('/assignments', async (req, res, next) => {
  const back = req.get('referer') || '/management';
  try {
    await addAssignment(String(req.body.opportunityId || ''), {
      personName: String(req.body.personName || '').trim(),
      plannedStartDate: String(req.body.plannedStartDate || '').slice(0, 10),
      plannedEndDate: String(req.body.plannedEndDate || '').slice(0, 10),
      allocationPercent: num(req.body.allocationPercent) ?? undefined,
      allocatedHours: num(req.body.allocatedHours) ?? undefined,
      isTimelineVisible: true,
    });
    req.flash('success', 'Assignment created.');
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(back);
});

router.post('/assignments/:assignmentId/visibility', async (req, res, next) => {
  const back = req.get('referer') || '/management';
  try {
    await updateAssignment(req.params.assignmentId, {
      isTimelineVisible: String(req.body.isTimelineVisible) === 'true',
    });
    req.flash('success', 'Timeline visibility updated.');
  } catch (err) {
    req.flash('error', err.message || String(err));
  }
  res.redirect(back);
});

module.exports = router;
