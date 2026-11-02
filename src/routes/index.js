const express = require('express');
const ExcelJS = require('exceljs');
const { listOpportunities, listOpenNextSteps, STAGES, STATUSES, PAGE_SIZE } = require('../services/opportunityService');
const { buildUpcoming, nextStepByOpportunity, stageBadgeClass, UPCOMING_PERIODS } = require('../services/capacityService');
const { BOOKING_MODES, bookingMode, bookingLabel, countsTowardsCapacity, listFirmStages } = require('../services/bookingService');
const { listPeople } = require('../services/peopleService');
const { getViewDefaults, updateViewDefaults } = require('../config/settings');
const { queryList, filterAgainst } = require('../services/filterService');
const { isDatabaseUnavailable } = require('../db/pool');
const { userKey } = require('../middleware/auth');

const router = express.Router();

const SORTS = ['updated', 'created', 'name', 'hours', 'stage', 'owner'];
const VIEW_COOKIE = 'opp-pipeline-view';

/** Reads the pipeline filters from the query string, falling back to the saved defaults. */
function readFilters(req) {
  const defaults = getViewDefaults(userKey(req)).pipeline;

  // "applied" marks a deliberate filter submission, so clearing every box is
  // honoured instead of silently falling back to the saved defaults.
  const applied = req.query.applied === '1';
  const stages = applied ? filterAgainst(queryList(req.query.stage), STAGES) : filterAgainst(defaults.stages, STAGES);
  const statuses = applied ? filterAgainst(queryList(req.query.status), STATUSES) : filterAgainst(defaults.statuses, STATUSES);
  const sort = SORTS.includes(String(req.query.sort)) ? String(req.query.sort) : 'updated';
  const defaultDir = sort === 'name' || sort === 'stage' || sort === 'owner' ? 'asc' : 'desc';

  return {
    defaults,
    filters: {
      q: String(req.query.q || '').trim(),
      sort,
      dir: String(req.query.dir || defaultDir) === 'asc' ? 'asc' : 'desc',
      stage: stages,
      status: statuses,
      booking: ['soft', 'committed'].includes(String(req.query.booking)) ? String(req.query.booking) : '',
      applied,
    },
  };
}

/** Table or board: an explicit choice is remembered in a cookie for next time. */
function readView(req, res) {
  const asked = String(req.query.view || '');
  if (asked === 'board' || asked === 'table') {
    res.cookie(VIEW_COOKIE, asked, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax', httpOnly: true });
    return asked;
  }
  const remembered = req.cookies && req.cookies[VIEW_COOKIE];
  return remembered === 'board' ? 'board' : 'table';
}

function applyBookingFilter(rows, booking, firmStages) {
  const wantCommitted = booking === 'committed';
  return rows.filter((row) => countsTowardsCapacity(row, firmStages) === wantCommitted);
}

function readLimit(req) {
  if (req.query.limit === 'all') return null;
  const asked = Number(req.query.limit);
  return Number.isInteger(asked) && asked > 0 ? asked : PAGE_SIZE;
}

router.get('/', async (req, res, next) => {
  const { defaults, filters } = readFilters(req);
  const view = readView(req, res);
  const limit = readLimit(req);

  const upcomingPeriod = String(req.query.period || 'this-week');
  const firmStages = listFirmStages();

  const bookingHelpers = {
    bookingModes: BOOKING_MODES,
    bookingMode,
    bookingLabel: (opportunity) => bookingLabel(opportunity, firmStages),
    isCommitted: (opportunity) => countsTowardsCapacity(opportunity, firmStages),
    firmStages,
  };

  const sameAsDefault = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // Every link that changes one thing (sort, view, page size) keeps the rest.
  const queryWith = (overrides) => {
    const params = new URLSearchParams();
    const state = { applied: '1', q: filters.q, sort: filters.sort, dir: filters.dir, booking: filters.booking, period: upcomingPeriod, ...overrides };
    if (limit !== PAGE_SIZE && !('limit' in overrides)) state.limit = limit === null ? 'all' : String(limit);
    Object.entries(state).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.append(key, value);
    });
    filters.stage.forEach((stage) => params.append('stage', stage));
    filters.status.forEach((status) => params.append('status', status));
    return params.toString();
  };

  const baseModel = {
    title: 'Opportunity pipeline',
    filters,
    stages: STAGES,
    statuses: STATUSES,
    people: listPeople(),
    view,
    limit,
    pageSize: PAGE_SIZE,
    queryWith,
    upcomingPeriod,
    upcomingPeriods: UPCOMING_PERIODS,
    stageBadgeClass,
    savedDefaults: defaults,
    personalDefaults: !!userKey(req),
    filtersMatchDefault: sameAsDefault(filters.stage, defaults.stages) && sameAsDefault(filters.status, defaults.statuses),
    ...bookingHelpers,
  };

  try {
    // Booking is worked out in code, not stored, so that filter is applied
    // after the read and paging happens afterwards.
    const [allRows, nextSteps] = await Promise.all([
      listOpportunities({ ...filters, limit: filters.booking || limit === null ? undefined : limit }),
      // A missing next-step read should never take the whole pipeline down.
      listOpenNextSteps().catch(() => []),
    ]);
    const matching = filters.booking ? applyBookingFilter(allRows, filters.booking, firmStages) : allRows;
    const opportunities = filters.booking && limit !== null ? matching.slice(0, limit) : matching;
    opportunities.total = filters.booking ? matching.length : allRows.total;

    const upcoming = buildUpcoming(opportunities, upcomingPeriod, nextSteps);
    const model = {
      ...baseModel,
      opportunities,
      total: opportunities.total || opportunities.length,
      nextStepFor: nextStepByOpportunity(nextSteps),
      upcoming,
      loadError: null,
    };

    if (req.query.partial === 'upcoming') {
      return res.render('partials/upcoming-card', {
        upcoming,
        upcomingPeriod,
        upcomingPeriods: UPCOMING_PERIODS,
        filters,
        collapsed: false,
      });
    }

    if (req.query.partial === 'pipeline') return res.render('pipeline-content', model);
    res.render('pipeline', model);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      const errorModel = {
        ...baseModel,
        opportunities: [],
        total: 0,
        nextStepFor: {},
        upcoming: { items: [], label: '' },
        loadError: err.message || String(err),
      };
      if (req.query.partial === 'pipeline') return res.render('pipeline-content', errorModel);
      return res.render('pipeline', errorModel);
    }
    next(err);
  }
});

/** The pipeline as it is currently filtered, as an Excel file. */
router.get('/pipeline/export', async (req, res, next) => {
  const { filters } = readFilters(req);
  try {
    const firmStages = listFirmStages();
    const [allRows, nextSteps] = await Promise.all([listOpportunities(filters), listOpenNextSteps().catch(() => [])]);
    const opportunities = filters.booking ? applyBookingFilter(allRows, filters.booking, firmStages) : allRows;
    const nextStepFor = nextStepByOpportunity(nextSteps);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pipeline');
    ws.columns = [
      { header: 'OPP-ID', key: 'oppId', width: 14 },
      { header: 'Opportunity', key: 'name', width: 34 },
      { header: 'Lead consultant', key: 'owner', width: 22 },
      { header: 'Business owner', key: 'business', width: 22 },
      { header: 'Stage', key: 'stage', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Booking', key: 'booking', width: 12 },
      { header: 'Hours', key: 'hours', width: 10 },
      { header: 'Planned start', key: 'start', width: 14 },
      { header: 'Planned end', key: 'end', width: 14 },
      { header: 'Next step', key: 'nextStep', width: 36 },
      { header: 'Next step due', key: 'nextStepDue', width: 14 },
      { header: 'Technology stack', key: 'stack', width: 26 },
      { header: 'Tags', key: 'tags', width: 22 },
      { header: 'Created', key: 'created', width: 14 },
      { header: 'Updated', key: 'updated', width: 14 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
    opportunities.forEach((o) => {
      const step = nextStepFor[String(o.Id)];
      ws.addRow({
        oppId: o.OppId || '',
        name: o.Name || '',
        owner: o.TechOwner || '',
        business: o.BusinessOwner || '',
        stage: o.Stage || '',
        status: o.Status || '',
        priority: o.Priority == null ? '' : Number(o.Priority),
        booking: countsTowardsCapacity(o, firmStages) ? 'Committed' : 'Soft',
        hours: Number(o.OpportunityHours || 0),
        start: day(o.PlannedStartDate),
        end: day(o.PlannedEndDate),
        nextStep: step ? step.title : '',
        nextStepDue: step ? step.dueText : '',
        stack: o.TechnologyStack || '',
        tags: o.Tags || '',
        created: day(o.CreatedAt),
        updated: day(o.UpdatedAt),
      });
    });
    ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pipeline-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

/** Remembers the current stage/status selection as this person's pipeline default. */
router.post('/pipeline/defaults', async (req, res) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    await updateViewDefaults(
      'pipeline',
      {
        stages: filterAgainst(queryList(req.body.stage), STAGES),
        statuses: filterAgainst(queryList(req.body.status), STATUSES),
      },
      userKey(req)
    );
    if (isAjax) return res.json({ ok: true });
    req.flash('success', 'Saved as your default pipeline filters.');
  } catch (err) {
    if (isAjax) return res.status(400).json({ error: err.message || String(err) });
    req.flash('error', err.message || String(err));
  }
  res.redirect(req.get('referer') || '/');
});

module.exports = router;
