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
  buildManagementView,
  stageStatusLabel,
  stageAccentClass,
  capacityClass,
} = require('../services/capacityService');
const { listFirmStages } = require('../services/bookingService');
const { isDatabaseUnavailable } = require('../db/pool');

const router = express.Router();

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

router.get('/', async (req, res, next) => {
  const perspectiveKey = String(req.query.perspective || 'months');
  const perspective = TIMELINE_UNIT_OPTIONS.some((option) => option.key === perspectiveKey) ? perspectiveKey : 'months';
  const unitsToShow = Math.min(24, Math.max(1, num(req.query.units) || 6));
  const stageFilter = String(req.query.stage || '');

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

    const view = buildManagementView({ opportunities, assignments, perspective, unitsToShow, stageFilter });

    res.render('management', {
      title: 'Team capacity',
      monthlyCapacity: MONTHLY_CAPACITY,
      perspective,
      unitsToShow,
      stageFilter,
      timelineUnitOptions: TIMELINE_UNIT_OPTIONS,
      stageLegend: STAGE_LEGEND,
      people: listPeople(),
      projects: opportunities,
      view,
      firmStages: listFirmStages(),
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
