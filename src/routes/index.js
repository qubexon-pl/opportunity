const express = require('express');
const { listOpportunities, STAGES, STATUSES } = require('../services/opportunityService');
const { buildUpcoming, stageBadgeClass, UPCOMING_PERIODS } = require('../services/capacityService');
const { BOOKING_MODES, bookingMode, bookingLabel, countsTowardsCapacity, listFirmStages } = require('../services/bookingService');
const { isDatabaseUnavailable } = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res, next) => {
  const filters = {
    q: String(req.query.q || '').trim(),
    sort: String(req.query.sort || 'updated'),
    dir: String(req.query.dir || 'desc'),
    stage: String(req.query.stage || '').trim(),
    status: String(req.query.status || '').trim(),
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

  try {
    const opportunities = await listOpportunities(filters);

    res.render('pipeline', {
      title: 'Opportunity pipeline',
      opportunities,
      filters,
      stages: STAGES,
      statuses: STATUSES,
      upcoming: buildUpcoming(opportunities, upcomingPeriod),
      upcomingPeriod,
      upcomingPeriods: UPCOMING_PERIODS,
      stageBadgeClass,
      ...bookingHelpers,
      loadError: null,
    });
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return res.render('pipeline', {
        title: 'Opportunity pipeline',
        opportunities: [],
        filters,
        stages: STAGES,
        statuses: STATUSES,
        upcoming: { items: [], label: '' },
        upcomingPeriod,
        upcomingPeriods: UPCOMING_PERIODS,
        stageBadgeClass,
        ...bookingHelpers,
        loadError: err.message || String(err),
      });
    }
    next(err);
  }
});

/** Inline capacity booking control on the pipeline. */

module.exports = router;
