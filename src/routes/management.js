const express = require('express');
const ExcelJS = require('exceljs');
const { listOpportunities } = require('../services/opportunityService');
const { listAssignments, addAssignment, updateAssignment, ALLOCATION_MODES } = require('../services/assignmentService');
const { listPeople, getDailyHoursMap, getRoleMap, getCostMap, getManagerMap, PERSON_ROLES, COST_CURRENCY } = require('../services/peopleService');
const {
  MONTHLY_CAPACITY,
  toDateText,
  isHoldExpired,
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
const { listAbsences, listAllAbsences, ABSENCE_KINDS } = require('../services/absenceService');
const { getViewDefaults, updateViewDefaults } = require('../config/settings');
const { queryList, filterAgainst } = require('../services/filterService');
const { STAGES, STATUSES } = require('../services/opportunityService');
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

/**
 * Resolves the person selection, honouring the manager filter as a hierarchy:
 * picking a manager means "the people who report to them", and combining it
 * with named people keeps only the ones who do both.
 *
 * Returns `active` separately because an empty person list is ambiguous on its
 * own: it means "everyone" when nothing is filtered, but "nobody" when a
 * manager was chosen and nobody reports to them.
 */
function resolvePeopleSelection({ requestedPeople, requestedManagers, personOptions, managerOptions, managersMap }) {
  const managerFilters = filterAgainst(requestedManagers, managerOptions);
  const personFilters = filterAgainst(requestedPeople, personOptions);

  if (!managerFilters.length) {
    return { managerFilters, personFilters, people: personFilters, active: personFilters.length > 0 };
  }

  const reports = personOptions.filter((name) => managerFilters.includes(String(managersMap[name] || '').trim()));
  const people = personFilters.length ? personFilters.filter((name) => reports.includes(name)) : reports;

  return { managerFilters, personFilters, people, active: true };
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
  const statusFilters = applied
    ? filterAgainst(queryList(req.query.status), STATUSES)
    : filterAgainst(defaults.statuses, STATUSES);
  const requestedPeople = applied ? queryList(req.query.person) : defaults.people;
  const requestedManagers = applied ? queryList(req.query.manager) : defaults.managers;

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

    // Manager options: anyone who is a manager of at least one person.
    const managersMap = getManagerMap();
    const managerOptions = [...new Set(Object.values(managersMap).map((m) => String(m).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    const selection = resolvePeopleSelection({
      requestedPeople,
      requestedManagers,
      personOptions,
      managerOptions,
      managersMap,
    });
    const { managerFilters, personFilters } = selection;

    const view = buildManagementView({
      opportunities,
      assignments,
      perspective,
      unitsToShow,
      stageFilter: stageFilters,
      statusFilter: statusFilters,
      personFilter: selection.people,
      personFilterActive: selection.active,
      sort: req.query.sort,
      dir: req.query.dir,
      peopleSort: req.query.peopleSort,
      peopleDir: req.query.peopleDir,
    });

    const sameStages = JSON.stringify([...stageFilters].sort()) === JSON.stringify([...defaults.stages].sort());
    const sameStatuses = JSON.stringify([...statusFilters].sort()) === JSON.stringify([...defaults.statuses].sort());
    const samePeople = JSON.stringify([...personFilters].sort()) === JSON.stringify([...defaults.people].sort());
    const sameManagers = JSON.stringify([...managerFilters].sort()) === JSON.stringify([...defaults.managers].sort());

    // Sort links have to carry the whole filter state, otherwise clicking a
    // column header would silently reset the perspective and filters.
    const baseParams = [
      ['applied', '1'],
      ['perspective', perspective],
      ['units', String(unitsToShow)],
      ...stageFilters.map((stage) => ['stage', stage]),
      ...statusFilters.map((status) => ['status', status]),
      ...personFilters.map((name) => ['person', name]),
      ...managerFilters.map((name) => ['manager', name]),
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

    const isPartial = req.query.partial === '1';
    res.render(isPartial ? 'management-content' : 'management', {
      title: 'Team capacity',
      monthlyCapacity: MONTHLY_CAPACITY,
      hoursPerDay: HOURS_PER_DAY,
      perspective,
      unitsToShow,
      stageFilters,
      statusFilters,
      statusOptions: STATUSES,
      personFilters,
      personOptions,
      managerFilters,
      managerOptions,
      // The people the filters actually select, managers resolved to their
      // reports. Views must use this rather than personFilters, or picking a
      // manager alone looks like no filter at all.
      selectedPeople: selection.people,
      peopleSelectionActive: selection.active,
      peopleManagers: managersMap,
      timelineFilterOptions: TIMELINE_FILTER_OPTIONS,
      timelineUnitOptions: TIMELINE_UNIT_OPTIONS,
      stageLegend: STAGE_LEGEND,
      people: listPeople(),
      peopleDailyHours: getDailyHoursMap(),
      peopleRoles: getRoleMap(),
      peopleCosts: getCostMap(),
      personRoles: PERSON_ROLES,
      costCurrency: COST_CURRENCY,
      allAbsences: listAllAbsences(),
      absenceKinds: ABSENCE_KINDS,
      projects: opportunities,
      view,
      assignmentSortFields: ASSIGNMENT_SORT_FIELDS,
      peopleSortFields: PEOPLE_SORT_FIELDS,
      queryWith,
      firmStages: listFirmStages(),
      savedDefaults: defaults,
      filtersMatchDefault: sameStages && sameStatuses && samePeople && sameManagers && perspective === defaults.perspective && unitsToShow === defaults.units,
      loadError,
      stageStatusLabel,
      stageAccentClass,
      capacityClass,
      toDateText,
      isHoldExpired,
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

    // Build a timeline filtered to just this person.
    const timelineView = buildManagementView({
      opportunities,
      assignments,
      perspective,
      unitsToShow,
      stageFilter: [],
      statusFilter: [],
      personFilter: [person],
    });

    if (req.query.partial === 'absences') {
      return res.render('partials/person-absences', {
        detail,
        allAbsences: listAbsences(person),
        absenceKinds: ABSENCE_KINDS,
      });
    }

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
      timeline: timelineView.timeline,
      absenceKinds: ABSENCE_KINDS,
      allAbsences: listAbsences(person),
      loadError,
      stageStatusLabel,
      stageAccentClass,
      capacityClass,
      toDateText,
      isHoldExpired,
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
      statuses: filterAgainst(queryList(req.body.status), STATUSES),
      people: queryList(req.body.person).map((name) => String(name)),
      managers: queryList(req.body.manager).map((name) => String(name)),
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

/** Exports the assignments table (with current filters) as an xlsx file. */
router.get('/assignments/export', async (req, res, next) => {
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
  const statusFilters = applied
    ? filterAgainst(queryList(req.query.status), STATUSES)
    : filterAgainst(defaults.statuses, STATUSES);
  const requestedPeople = applied ? queryList(req.query.person) : defaults.people;
  const requestedManagers = applied ? queryList(req.query.manager) : defaults.managers;

  try {
    const [opportunities, assignments] = await Promise.all([
      listOpportunities({ sort: 'name', dir: 'asc' }),
      listAssignments({ includeHidden: true }),
    ]);

    const personOptions = [
      ...new Set([...listPeople(), ...assignments.map((a) => a.PersonName).filter(Boolean)]),
    ].sort((a, b) => a.localeCompare(b));

    const managersMap = getManagerMap();
    const managerOptions = [...new Set(Object.values(managersMap).map((m) => String(m).trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    const selection = resolvePeopleSelection({
      requestedPeople,
      requestedManagers,
      personOptions,
      managerOptions,
      managersMap,
    });

    const view = buildManagementView({
      opportunities,
      assignments,
      perspective,
      unitsToShow,
      stageFilter: stageFilters,
      statusFilter: statusFilters,
      personFilter: selection.people,
      personFilterActive: selection.active,
      sort: req.query.sort,
      dir: req.query.dir,
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Assignments');

    const headers = [
      'OPP-ID',
      'Person',
      'Opportunity',
      'Stage',
      'Status',
      'Start Date',
      'End Date',
      'Project Allocation %',
      'Allocated Hours',
      'Booking',
      'Hold Periods',
      'Timeline Visible',
    ];
    ws.addRow(headers);

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

    for (const row of view.assignmentRows) {
      const holdText = (row.holds || [])
        .map((h) => `${h.startDate} -> ${h.endDate}`)
        .join('; ');
      ws.addRow([
        row.OppId || '',
        row.PersonName || '',
        row.OpportunityName || '',
        row.Stage || '',
        row.Status || '',
        row.StartDate || '',
        row.EndDate || '',
        Number(row.InitialPercent || 0),
        Number(row.AllocatedHours || 0),
        row.IsCommitted ? 'Committed' : 'Soft',
        holdText,
        row.IsTimelineVisible ? 'Yes' : 'No',
      ]);
    }

    const colWidths = [14, 20, 30, 18, 14, 14, 14, 16, 14, 14, 30, 14];
    ws.columns.forEach((col, i) => { col.width = colWidths[i]; });
    ws.getColumn(8).numFmt = '0.0"%"';
    ws.getColumn(9).numFmt = '0.0';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="assignments.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
