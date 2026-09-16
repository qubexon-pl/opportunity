const express = require('express');
const { listOpportunities, listOpenNextSteps, STAGES, STATUSES } = require('../services/opportunityService');
const { buildUpcoming, stageBadgeClass, UPCOMING_PERIODS } = require('../services/capacityService');
const { BOOKING_MODES, bookingMode, bookingLabel, countsTowardsCapacity, listFirmStages } = require('../services/bookingService');
const { getViewDefaults, updateViewDefaults } = require('../config/settings');
const { queryList, filterAgainst } = require('../services/filterService');
const { isDatabaseUnavailable } = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res, next) => {
  const defaults = getViewDefaults().pipeline;

  // "applied" marks a deliberate filter submission, so clearing every box is
  // honoured instead of silently falling back to the saved defaults.
  const applied = req.query.applied === '1';
  const stages = applied ? filterAgainst(queryList(req.query.stage), STAGES) : filterAgainst(defaults.stages, STAGES);
  const statuses = applied ? filterAgainst(queryList(req.query.status), STATUSES) : filterAgainst(defaults.statuses, STATUSES);

  const filters = {
    q: String(req.query.q || '').trim(),
    sort: String(req.query.sort || 'updated'),
    dir: String(req.query.dir || 'desc'),
    stage: stages,
    status: statuses,
    applied,
  };

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

  const baseModel = {
    title: 'Opportunity pipeline',
    filters,
    stages: STAGES,
    statuses: STATUSES,
    upcomingPeriod,
    upcomingPeriods: UPCOMING_PERIODS,
    stageBadgeClass,
    savedDefaults: defaults,
    filtersMatchDefault: sameAsDefault(stages, defaults.stages) && sameAsDefault(statuses, defaults.statuses),
    ...bookingHelpers,
  };

  try {
    const opportunities = await listOpportunities(filters);
    // A missing next-step read should never take the whole pipeline down.
    const nextSteps = await listOpenNextSteps().catch(() => []);

    const upcoming = buildUpcoming(opportunities, upcomingPeriod, nextSteps);

    if (req.query.partial === 'upcoming') {
      return res.render('partials/upcoming-card', {
        upcoming,
        upcomingPeriod,
        upcomingPeriods: UPCOMING_PERIODS,
        filters,
      });
    }

    if (req.query.partial === 'pipeline') {
      return res.render('pipeline-content', {
        ...baseModel,
        opportunities,
        upcoming,
        loadError: null,
      });
    }

    res.render('pipeline', {
      ...baseModel,
      opportunities,
      upcoming,
      loadError: null,
    });
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      const errorModel = {
        ...baseModel,
        opportunities: [],
        upcoming: { items: [], label: '' },
        loadError: err.message || String(err),
      };
      if (req.query.partial === 'pipeline') return res.render('pipeline-content', errorModel);
      return res.render('pipeline', errorModel);
    }
    next(err);
  }
});

/** Remembers the current stage/status selection as the pipeline default. */
router.post('/pipeline/defaults', (req, res) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    updateViewDefaults('pipeline', {
      stages: filterAgainst(queryList(req.body.stage), STAGES),
      statuses: filterAgainst(queryList(req.body.status), STATUSES),
    });
    if (isAjax) return res.json({ ok: true });
    req.flash('success', 'Saved as your default pipeline filters.');
  } catch (err) {
    if (isAjax) return res.status(400).json({ error: err.message || String(err) });
    req.flash('error', err.message || String(err));
  }
  res.redirect(req.get('referer') || '/');
});

module.exports = router;
