const express = require('express');
const { listOpportunities } = require('../services/opportunityService');
const { listAssignments, addAssignment, updateAssignment, ALLOCATION_MODES } = require('../services/assignmentService');
const { listPeople, getDailyHoursMap } = require('../services/peopleService');
const {
  MONTHLY_CAPACITY,
  toDateText,
} = require('../services/dateService');
const {
  TIMELINE_UNIT_OPTIONS,
  STAGE_LEGEND,
  HOURS_PER_DAY,
  ASSIGNMENT_SORT_FIELDS,
  PEOPLE_SORT_FIELDS,
  buildManagementView,
  buildPersonDetail,
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

/** Allocation inputs only make sense above zero; anything else means "not supplied". */
function positiveNum(value) {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : undefined;
}

/** Keeps an unrecognised allocation mode out of the service payload. */
function allocationMode(value) {
  const mode = String(value ?? '').trim();
  return ALLOCATION_MODES.includes(mode) ? mode : undefined;
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
  const requestedPeople = applied ? queryList(req.query.person) : defaults.people;

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

    // People with assignments can be filtered even if they are no longer configured.
    const personOptions = [
      ...new Set([...listPeople(), ...assignments.map((assignment) => assignment.PersonName).filter(Boolean)]),
    ].sort((a, b) => a.localeCompare(b));
    const personFilters = filterAgainst(requestedPeople, personOptions);

    const view = buildManagementView({
      opportunities,
      assignments,
      perspective,
      unitsToShow,
      stageFilter: stageFilters,
      personFilter: personFilters,
      sort: req.query.sort,
      dir: req.query.dir,
      peopleSort: req.query.peopleSort,
      peopleDir: req.query.peopleDir,
    });

    const sameStages = JSON.stringify([...stageFilters].sort()) === JSON.stringify([...defaults.stages].sort());
    const samePeople = JSON.stringify([...personFilters].sort()) === JSON.stringify([...defaults.people].sort());

    // Sort links have to carry the whole filter state, otherwise clicking a
    // column header would silently reset the perspective and filters.
    const baseParams = [
      ['applied', '1'],
      ['perspective', perspective],
      ['units', String(unitsToShow)],
      ...stageFilters.map((stage) => ['stage', stage]),
      ...personFilters.map((name) => ['person', name]),
    ];
    const current = {
      sort: view.sort.key,
      dir: view.sort.dir,
      peopleSort: view.peopleSort.key,
      peopleDir: view.peopleSort.dir,
    };
    const queryWith = (overrides) => {
      const params = new URLSearchParams(baseParams);
      Object.entries({ ...current, ...overrides }).forEach(([key, value]) => params.append(key, value));
      return params.toString();
    };

    res.render('management', {
      title: 'Team capacity',
      monthlyCapacity: MONTHLY_CAPACITY,
      hoursPerDay: HOURS_PER_DAY,
      perspective,
      unitsToShow,
      stageFilters,
      personFilters,
      personOptions,
      timelineFilterOptions: TIMELINE_FILTER_OPTIONS,
      timelineUnitOptions: TIMELINE_UNIT_OPTIONS,
      stageLegend: STAGE_LEGEND,
      people: listPeople(),
      peopleDailyHours: getDailyHoursMap(),
      projects: opportunities,
      view,
      assignmentSortFields: ASSIGNMENT_SORT_FIELDS,
      peopleSortFields: PEOPLE_SORT_FIELDS,
      queryWith,
      firmStages: listFirmStages(),
      savedDefaults: defaults,
      filtersMatchDefault: sameStages && samePeople && perspective === defaults.perspective && unitsToShow === defaults.units,
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

/** One person's capacity for the selected window, broken down period by period. */
router.get('/people/:person', async (req, res, next) => {
  const defaults = getViewDefaults().management;
  const perspective = normalizePerspective(
    req.query.perspective === undefined ? defaults.perspective : req.query.perspective,
    defaults.perspective
  );
  const unitsToShow = normalizeUnits(req.query.units === undefined ? defaults.units : req.query.units, defaults.units);
  const person = String(req.params.person || '');

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

    const detail = buildPersonDetail({ opportunities, assignments, perspective, unitsToShow, person });

    res.render('person', {
      title: person,
      breadcrumb: [
        { label: 'Management', href: '/management' },
        { label: person || 'Person', href: req.originalUrl },
      ],
      detail,
      perspective,
      unitsToShow,
      timelineUnitOptions: TIMELINE_UNIT_OPTIONS,
      loadError,
      stageStatusLabel,
      stageAccentClass,
      capacityClass,
      toDateText,
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
      people: queryList(req.body.person).map((name) => String(name)),
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
    // Same payload shape as the opportunity assignment form, so both entry
    // points resolve percent and hours through one rule.
    await addAssignment(String(req.body.opportunityId || ''), {
      personName: String(req.body.personName || '').trim(),
      plannedStartDate: String(req.body.plannedStartDate || '').slice(0, 10),
      plannedEndDate: String(req.body.plannedEndDate || '').slice(0, 10),
      allocationPercent: positiveNum(req.body.allocationPercent),
      allocatedHours: positiveNum(req.body.allocatedHours),
      allocationMode: allocationMode(req.body.allocationMode),
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
