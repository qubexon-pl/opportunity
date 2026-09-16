const express = require('express');
const {
  STAGES,
  STATUSES,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  setBookingFlag,
  deleteOpportunity,
  addNote,
  deleteNote,
  addStep,
  setStepDone,
  deleteStep,
} = require('../services/opportunityService');
const { addAssignment, updateAssignment, deleteAssignment, ALLOCATION_MODES } = require('../services/assignmentService');
const { listPeople, getDailyHoursMap } = require('../services/peopleService');
const { calculateEndDate, calculateDurationWorkDays, toDateText, round2, parseHolds, isCurrentlyOnHold, isHoldExpired } = require('../services/dateService');
const { stageStatusLabel, stageAccentClass, stageBadgeClass, buildOpportunityAbsenceImpact } = require('../services/capacityService');
const {
  BOOKING_MODES,
  bookingMode,
  bookingModeToFlag,
  bookingLabel,
  countsTowardsCapacity,
  listFirmStages,
} = require('../services/bookingService');

const router = express.Router();

function text(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
  return value === 'on' || value === 'true' || value === true;
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

/** Parses paired holdStartDate[]/holdEndDate[] arrays from the form body. */
function parseHoldPairs(body) {
  const starts = Array.isArray(body.holdStartDate) ? body.holdStartDate : body.holdStartDate ? [body.holdStartDate] : [];
  const ends = Array.isArray(body.holdEndDate) ? body.holdEndDate : body.holdEndDate ? [body.holdEndDate] : [];
  const pairs = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const start = String(starts[i] || '').slice(0, 10);
    const end = String(ends[i] || '').slice(0, 10);
    if (start || end) pairs.push({ startDate: start, endDate: end });
  }
  return pairs;
}

/** Maps the opportunity form body onto the service payload shape. */
function opportunityPayload(body) {
  const opportunityHours = num(body.opportunityHours);
  const plannedStartDate = text(body.plannedStartDate);
  let plannedEndDate = text(body.plannedEndDate);

  if (!plannedEndDate && plannedStartDate && opportunityHours) {
    plannedEndDate = calculateEndDate(plannedStartDate, opportunityHours, 100);
  }

  return {
    name: String(body.name ?? '').trim(),
    oppId: text(body.oppId),
    technologyStack: text(body.technologyStack),
    description: text(body.description),
    techOwner: text(body.techOwner),
    businessOwner: text(body.businessOwner),
    firstContactDate: text(body.firstContactDate),
    stage: text(body.stage),
    status: text(body.status),
    priority: num(body.priority),
    tags: text(body.tags),
    nextStepSummary: text(body.nextStepSummary),
    nextStepDueDate: text(body.nextStepDueDate),
    opportunityHours: opportunityHours ?? 0,
    opportunityTimeline: text(body.opportunityTimeline),
    plannedStartDate,
    plannedEndDate,
    allocationPercent: num(body.allocationPercent),
    countsTowardsCapacity: bookingModeToFlag(String(body.bookingMode || 'auto')),
  };
}

function emptyForm() {
  return {
    Name: '',
    TechnologyStack: '',
    Description: '',
    TechOwner: '',
    BusinessOwner: '',
    FirstContactDate: '',
    Stage: 'New',
    Status: 'Open',
    Priority: 3,
    Tags: '',
    NextStepSummary: '',
    NextStepDueDate: '',
    OpportunityHours: '',
    OpportunityTimeline: '',
    PlannedStartDate: '',
    PlannedEndDate: '',
    AllocationPercent: 100,
    CountsTowardsCapacity: null,
  };
}

function baseViewModel(extra) {
  const firmStages = listFirmStages();
  return {
    stages: STAGES,
    statuses: STATUSES,
    people: listPeople(),
    peopleDailyHours: getDailyHoursMap(),
    stageStatusLabel,
    stageAccentClass,
    stageBadgeClass,
    bookingModes: BOOKING_MODES,
    bookingMode,
    bookingLabel: (opportunity) => bookingLabel(opportunity, firmStages),
    isCommitted: (opportunity) => countsTowardsCapacity(opportunity, firmStages),
    firmStages,
    toDateText,
    round2,
    parseHolds,
    isCurrentlyOnHold,
    isHoldExpired,
    ...extra,
  };
}

function friendlyError(err) {
  const message = err && err.issues ? err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : err.message;
  return message || String(err);
}

// ──── New opportunity ────
router.get('/', (req, res) => {
  res.redirect('/');
});

router.get('/new', (req, res) => {
  res.render(
    'opportunities/form',
    baseViewModel({
      title: 'Create opportunity',
      mode: 'new',
      opportunity: emptyForm(),
      plannedEndPreview: null,
      plannedDurationPreview: null,
      partial: false,
    })
  );
});

router.post('/', async (req, res, next) => {
  try {
    const payload = opportunityPayload(req.body);
    if (payload.opportunityHours == null || payload.opportunityHours < 0) {
      req.flash('error', 'Opportunity hours is required.');
      return res.redirect('/opportunities/new');
    }
    const id = await createOpportunity(payload);
    req.flash('success', 'Opportunity created.');
    res.redirect(`/opportunities/${id}`);
  } catch (err) {
    if (err && (err.issues || err.name === 'ZodError')) {
      req.flash('error', friendlyError(err));
      return res.redirect('/opportunities/new');
    }
    next(err);
  }
});

// ──── Detail ────
router.get('/:id', async (req, res, next) => {
  try {
    const detail = await getOpportunity(req.params.id);
    if (!detail) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Opportunity not found.',
        currentPath: req.path,
        breadcrumb: [{ label: 'Not found', href: '#' }],
      });
    }

    const opportunity = detail.opportunity;
    res.render(
      'opportunities/form',
      baseViewModel({
        title: opportunity.Name,
        mode: 'detail',
        opportunity,
        notes: detail.notes,
        nextSteps: detail.nextSteps,
        assignments: detail.assignments,
        absenceImpact: buildOpportunityAbsenceImpact(opportunity, detail.assignments),
        plannedEndPreview: calculateEndDate(toDateText(opportunity.PlannedStartDate), opportunity.OpportunityHours, 100),
        plannedDurationPreview: calculateDurationWorkDays(opportunity.OpportunityHours, 100),
        today: toDateText(new Date()),
        partial: req.query.partial === 'detail',
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:id', async (req, res, next) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    const payload = opportunityPayload(req.body);
    if (payload.opportunityHours == null || payload.opportunityHours < 0) {
      if (isAjax) return res.json({ ok: false, error: 'Opportunity hours is required.' });
      req.flash('error', 'Opportunity hours is required.');
      return res.redirect(`/opportunities/${req.params.id}`);
    }
    const updated = await updateOpportunity(req.params.id, payload);
    if (isAjax) return res.json({ ok: !!updated, error: updated ? null : 'Opportunity not found.' });
    req.flash(updated ? 'success' : 'error', updated ? 'Opportunity saved.' : 'Opportunity not found.');
    res.redirect(`/opportunities/${req.params.id}`);
  } catch (err) {
    if (err && (err.issues || err.name === 'ZodError')) {
      const msg = friendlyError(err);
      if (isAjax) return res.json({ ok: false, error: msg });
      req.flash('error', msg);
      return res.redirect(`/opportunities/${req.params.id}`);
    }
    next(err);
  }
});

/** Inline capacity booking control (used by the pipeline and the detail form). */
router.post('/:id/booking', async (req, res) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    const mode = String(req.body.bookingMode || 'auto');
    if (!BOOKING_MODES.some((option) => option.key === mode)) {
      throw new Error('Unknown booking mode.');
    }
    await setBookingFlag(req.params.id, bookingModeToFlag(mode));
    if (isAjax) return res.json({ ok: true });
    req.flash('success', 'Capacity booking updated.');
  } catch (err) {
    if (isAjax) return res.status(400).json({ error: friendlyError(err) });
    req.flash('error', friendlyError(err));
  }
  res.redirect(req.get('referer') || '/');
});

router.post('/:id/delete', async (req, res, next) => {
  try {
    const deleted = await deleteOpportunity(req.params.id);
    req.flash(deleted ? 'success' : 'error', deleted ? 'Opportunity deleted.' : 'Opportunity not found.');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// ──── Notes ────
router.post('/:id/notes', async (req, res, next) => {
  try {
    await addNote(req.params.id, {
      noteDate: String(req.body.noteDate || '').slice(0, 10),
      content: String(req.body.content || '').trim(),
    });
    req.flash('success', 'Note added.');
  } catch (err) {
    if (!err || !(err.issues || err.name === 'ZodError')) return next(err);
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#notes`);
});

router.post('/:id/notes/:noteId/delete', async (req, res, next) => {
  try {
    await deleteNote(req.params.noteId);
    req.flash('success', 'Note deleted.');
    res.redirect(`/opportunities/${req.params.id}#notes`);
  } catch (err) {
    next(err);
  }
});

// ──── Next steps ────
router.post('/:id/steps', async (req, res, next) => {
  try {
    await addStep(req.params.id, {
      title: String(req.body.title || '').trim(),
      dueDate: text(req.body.dueDate),
    });
    req.flash('success', 'Next step added.');
  } catch (err) {
    if (!err || !(err.issues || err.name === 'ZodError')) return next(err);
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#steps`);
});

router.post('/:id/steps/:stepId/toggle', async (req, res, next) => {
  try {
    await setStepDone(req.params.stepId, bool(req.body.isDone));
    res.redirect(`/opportunities/${req.params.id}#steps`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/steps/:stepId/delete', async (req, res, next) => {
  try {
    await deleteStep(req.params.stepId);
    req.flash('success', 'Next step deleted.');
    res.redirect(`/opportunities/${req.params.id}#steps`);
  } catch (err) {
    next(err);
  }
});

// ──── Assignments ────
router.post('/:id/assignments', async (req, res, next) => {
  try {
    await addAssignment(req.params.id, {
      personName: String(req.body.personName || '').trim(),
      plannedStartDate: String(req.body.plannedStartDate || '').slice(0, 10),
      plannedEndDate: String(req.body.plannedEndDate || '').slice(0, 10),
      allocationPercent: positiveNum(req.body.allocationPercent),
      allocatedHours: positiveNum(req.body.allocatedHours),
      allocationMode: allocationMode(req.body.allocationMode),
      isTimelineVisible: true,
      holds: parseHoldPairs(req.body),
    });
    req.flash('success', 'Assignment added.');
  } catch (err) {
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#assignments`);
});

router.post('/:id/assignments/:assignmentId', async (req, res, next) => {
  try {
    await updateAssignment(req.params.assignmentId, {
      personName: String(req.body.personName || '').trim(),
      plannedStartDate: String(req.body.plannedStartDate || '').slice(0, 10),
      plannedEndDate: String(req.body.plannedEndDate || '').slice(0, 10),
      allocationPercent: positiveNum(req.body.allocationPercent),
      allocatedHours: positiveNum(req.body.allocatedHours),
      allocationMode: allocationMode(req.body.allocationMode),
      isTimelineVisible: bool(req.body.isTimelineVisible),
      holds: parseHoldPairs(req.body),
    });
    req.flash('success', 'Assignment saved.');
  } catch (err) {
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#assignments`);
});

router.post('/:id/assignments/:assignmentId/stretch', async (req, res, next) => {
  try {
    const days = num(req.body.days) || 0;
    const endDate = new Date(String(req.body.plannedEndDate || '').slice(0, 10));
    const startDate = new Date(String(req.body.plannedStartDate || '').slice(0, 10));
    endDate.setDate(endDate.getDate() + days);

    if (endDate >= startDate) {
      await updateAssignment(req.params.assignmentId, {
        plannedStartDate: toDateText(startDate),
        plannedEndDate: toDateText(endDate),
      });
      req.flash('success', `Assignment ${days > 0 ? 'extended' : 'shortened'} by ${Math.abs(days)} days.`);
    } else {
      req.flash('error', 'End date cannot move before the start date.');
    }
  } catch (err) {
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#assignments`);
});

router.post('/:id/assignments/:assignmentId/delete', async (req, res, next) => {
  try {
    await deleteAssignment(req.params.assignmentId);
    req.flash('success', 'Assignment deleted.');
  } catch (err) {
    req.flash('error', friendlyError(err));
  }
  res.redirect(`/opportunities/${req.params.id}#assignments`);
});

module.exports = router;
module.exports.opportunityPayload = opportunityPayload;
