const {
  HOURS_PER_DAY,
  round2,
  toDate,
  toDateText,
  countBusinessDays,
  countBusinessDaysInclusive,
  startOfUnit,
  addUnit,
  formatUnitLabel,
  unitGroup,
  formatShortDate,
  unitsToCoverRange,
  periodBounds,
} = require('./dateService');
const { listPeople, getPersonDailyHours, getPersonRole } = require('./peopleService');
const { countsTowardsCapacity, listFirmStages } = require('./bookingService');

const TIMELINE_ROW_TOP_PADDING = 8;
const TIMELINE_LANE_HEIGHT = 58;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIMELINE_UNIT_OPTIONS = [
  { key: 'weeks', label: 'Weeks', defaultUnits: 12 },
  { key: 'months', label: 'Months', defaultUnits: 6 },
  { key: 'quarters', label: 'Quarter', defaultUnits: 4 },
  { key: 'halfyears', label: 'Half Year', defaultUnits: 2 },
];

const STAGE_LEGEND = [
  { key: 'new', label: 'New', meaning: 'Intake' },
  { key: 'discovery', label: 'Discovery', meaning: 'Scoping' },
  { key: 'proposal', label: 'Proposal', meaning: 'Proposal Ready' },
  { key: 'negotiation', label: 'Negotiation', meaning: 'In Negotiation' },
  { key: 'won', label: 'Won', meaning: 'Committed' },
  { key: 'lost', label: 'Lost', meaning: 'Stopped' },
];

const UPCOMING_PERIODS = [
  { key: 'this-week', label: 'This week' },
  { key: 'next-14', label: 'Next 14 days' },
  { key: 'this-month', label: 'This month' },
];

function stageStatusLabel(stage) {
  const found = STAGE_LEGEND.find((item) => item.key === String(stage || '').toLowerCase());
  return found ? found.meaning : 'Unclassified';
}

function stageAccentClass(stage) {
  const normalized = String(stage || '').toLowerCase();
  return STAGE_LEGEND.some((item) => item.key === normalized) ? `accent-${normalized}` : 'accent-new';
}

function stageBadgeClass(stage) {
  switch (String(stage || '').toLowerCase()) {
    case 'discovery':
      return 'stage-badge-discovery';
    case 'proposal':
      return 'stage-badge-proposal';
    case 'negotiation':
      return 'stage-badge-negotiation';
    case 'won':
      return 'stage-badge-won';
    case 'lost':
      return 'stage-badge-lost';
    default:
      return 'stage-badge-new';
  }
}

function capacityClass(hours) {
  if (hours < 0) return 'capacity-over';
  if (hours < 40) return 'capacity-tight';
  return 'capacity-available';
}

/** Traffic-light band for a chargeability percentage. */
function chargeabilityClass(percent) {
  if (percent > 100) return 'kpi-over';
  if (percent >= 75) return 'kpi-good';
  if (percent >= 50) return 'kpi-fair';
  return 'kpi-low';
}

/** Joins assignments with their opportunity, filling in derived hours. */
function buildAssignmentRows(opportunities, assignments) {
  const byId = new Map(opportunities.map((o) => [o.Id, o]));
  const firmStages = listFirmStages();

  return assignments
    .map((assignment) => {
      const opportunity = byId.get(assignment.OpportunityId);
      if (!opportunity) return null;
      const allocated = Number(assignment.AllocatedHours);
      const opportunityHours = Number(opportunity.OpportunityHours || 0);
      const fallback = round2(opportunityHours * (Number(assignment.AllocationPercent || 0) / 100));
      const currentHours = Number.isFinite(allocated) ? allocated : fallback;
      // Legacy rows have no stored initial figure; their percentage still
      // describes what was agreed, so derive it from the opportunity total.
      const storedInitial = Number(assignment.InitialAllocatedHours);
      const initialHours = Number.isFinite(storedInitial) && storedInitial > 0
        ? round2(storedInitial)
        : fallback > 0
          ? fallback
          : round2(currentHours);

      return {
        ...assignment,
        OpportunityName: opportunity.Name,
        Stage: opportunity.Stage,
        Status: opportunity.Status,
        OpportunityHours: opportunityHours,
        AllocatedHours: currentHours,
        InitialAllocatedHours: initialHours,
        InitialPercent: opportunityHours > 0 ? round2((initialHours / opportunityHours) * 100) : 0,
        IsResized: Math.abs(round2(currentHours) - initialHours) >= 0.01,
        StartDate: toDateText(assignment.PlannedStartDate),
        EndDate: toDateText(assignment.PlannedEndDate),
        HoldStartDate: toDateText(assignment.HoldStartDate),
        HoldEndDate: toDateText(assignment.HoldEndDate),
        IsOnHold: !!(assignment.HoldStartDate && assignment.HoldEndDate),
        IsTimelineVisible: !!assignment.IsTimelineVisible,
        IsCommitted: countsTowardsCapacity(opportunity, firmStages),
      };
    })
    .filter(Boolean);
}

/** Business days of an assignment's hold window that fall inside [from, toExclusive). */
function heldBusinessDays(assignment, from, toExclusive) {
  const holdStart = toDate(assignment.HoldStartDate);
  const holdEnd = toDate(assignment.HoldEndDate);
  if (!holdStart || !holdEnd) return 0;

  const holdEndExclusive = new Date(holdEnd);
  holdEndExclusive.setDate(holdEndExclusive.getDate() + 1);

  const overlapStart = new Date(Math.max(holdStart.getTime(), from.getTime()));
  const overlapEndExclusive = new Date(Math.min(holdEndExclusive.getTime(), toExclusive.getTime()));
  if (overlapEndExclusive <= overlapStart) return 0;

  return countBusinessDays(overlapStart, overlapEndExclusive);
}

/**
 * Portion of an assignment's hours that falls inside [windowStart, windowEndExclusive).
 *
 * Hours are consumed at the assignment's normal daily rate. Days inside a hold
 * window are skipped, so a hold frees the person's capacity for that period
 * without changing the assignment's stored total.
 */
function assignmentHoursInWindow(assignment, windowStart, windowEndExclusive) {
  const assignmentStart = toDate(assignment.StartDate || assignment.PlannedStartDate);
  const assignmentEnd = toDate(assignment.EndDate || assignment.PlannedEndDate);
  if (!assignmentStart || !assignmentEnd) return 0;

  const assignmentEndExclusive = new Date(assignmentEnd);
  assignmentEndExclusive.setDate(assignmentEndExclusive.getDate() + 1);

  const overlapStart = new Date(Math.max(assignmentStart.getTime(), windowStart.getTime()));
  const overlapEndExclusive = new Date(Math.min(assignmentEndExclusive.getTime(), windowEndExclusive.getTime()));
  if (overlapEndExclusive <= overlapStart) return 0;

  const totalBusinessDays = countBusinessDays(assignmentStart, assignmentEndExclusive);
  const overlapBusinessDays = countBusinessDays(overlapStart, overlapEndExclusive);
  const activeBusinessDays = overlapBusinessDays - heldBusinessDays(assignment, overlapStart, overlapEndExclusive);
  if (totalBusinessDays <= 0 || activeBusinessDays <= 0) return 0;

  const allocated = Number(assignment.AllocatedHours);
  const fallback = Number(assignment.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100);
  const totalHours = Number.isFinite(allocated) ? allocated : fallback;
  return totalHours * (activeBusinessDays / totalBusinessDays);
}

function capacityWindow(perspective, unitsToShow) {
  const start = startOfUnit(new Date(), perspective);
  const units = Math.max(1, Number(unitsToShow || 1));
  return { start, endExclusive: addUnit(start, perspective, units), units };
}

function timelineRange(scheduled, perspective, unitsToShow) {
  const horizonUnits = Math.max(1, Number(unitsToShow || 1));
  const dated = scheduled.filter((item) => item.StartDate && item.EndDate);
  const nowStart = startOfUnit(new Date(), perspective);

  if (!dated.length) {
    return { start: nowStart, endExclusive: addUnit(nowStart, perspective, horizonUnits), units: horizonUnits };
  }

  const minStart = new Date(Math.min(...dated.map((item) => new Date(item.StartDate).getTime())));
  const maxEnd = new Date(Math.max(...dated.map((item) => new Date(item.EndDate).getTime())));
  const start = startOfUnit(minStart, perspective);
  const units = Math.max(horizonUnits, unitsToCoverRange(start, maxEnd, perspective));
  return { start, endExclusive: addUnit(start, perspective, units), units };
}

function buildTimelineUnits(range, perspective) {
  return Array.from({ length: range.units }).map((_, index) => {
    const unitStart = addUnit(range.start, perspective, index);
    const group = unitGroup(unitStart, perspective);
    return {
      key: `${perspective}-${toDateText(unitStart)}`,
      label: formatUnitLabel(unitStart, perspective),
      groupKey: group.key,
      groupLabel: group.label,
    };
  });
}

/**
 * Collapses the unit list into the header band shown above the columns, so
 * consecutive weeks in the same month sit under one "June 2026" heading.
 */
function buildTimelineGroups(units) {
  return units.reduce((groups, unit) => {
    const last = groups[groups.length - 1];
    if (last && last.key === unit.groupKey) {
      last.span += 1;
      return groups;
    }
    groups.push({ key: unit.groupKey, label: unit.groupLabel, span: 1 });
    return groups;
  }, []);
}

function chipGeometry(range, startValue, endValue, laneIndex) {
  const rangeMs = range.endExclusive.getTime() - range.start.getTime();
  const start = toDate(startValue);
  const end = toDate(endValue);
  const top = TIMELINE_ROW_TOP_PADDING + laneIndex * TIMELINE_LANE_HEIGHT;

  if (!start || !end || rangeMs <= 0) return { left: 0, width: 1, top };

  const clippedStartMs = Math.max(start.getTime(), range.start.getTime());
  const clippedEndMs = Math.min(end.getTime() + DAY_MS, range.endExclusive.getTime());
  if (clippedEndMs <= clippedStartMs) return { left: 0, width: 0, top };

  const left = ((clippedStartMs - range.start.getTime()) / rangeMs) * 100;
  const width = ((clippedEndMs - clippedStartMs) / rangeMs) * 100;

  return {
    left: Math.max(0, Math.min(100, left)),
    width: Math.max(1, Math.min(100, width)),
    top,
  };
}

function freeGeometry(range, start, endExclusive, laneIndex) {
  const rangeMs = range.endExclusive.getTime() - range.start.getTime();
  const top = TIMELINE_ROW_TOP_PADDING + laneIndex * TIMELINE_LANE_HEIGHT;
  if (rangeMs <= 0) return { left: 0, width: 0, top };

  const windowStartMs = Math.max(start.getTime(), range.start.getTime());
  const windowEndMs = Math.min(endExclusive.getTime(), range.endExclusive.getTime());
  if (windowEndMs <= windowStartMs) return { left: 0, width: 0, top };

  return {
    left: Math.max(0, Math.min(100, ((windowStartMs - range.start.getTime()) / rangeMs) * 100)),
    width: Math.max(1, Math.min(100, ((windowEndMs - windowStartMs) / rangeMs) * 100)),
    top,
  };
}

function rowHeight(assignmentCount, includeFreeLane) {
  const lanes = Math.max(1, assignmentCount + (includeFreeLane ? 1 : 0));
  return Math.max(TIMELINE_LANE_HEIGHT + TIMELINE_ROW_TOP_PADDING, lanes * TIMELINE_LANE_HEIGHT + TIMELINE_ROW_TOP_PADDING);
}

/**
 * Free capacity bars, one per column of the selected perspective, so the
 * "free" figures line up with whatever period the timeline is showing.
 */
function freeSegments(assignmentsForPerson, personName, window, perspective) {
  const segments = [];
  let cursor = startOfUnit(window.start, perspective);

  while (cursor < window.endExclusive) {
    const nextUnit = addUnit(cursor, perspective, 1);
    const start = new Date(Math.max(cursor.getTime(), window.start.getTime()));
    const endExclusive = new Date(Math.min(nextUnit.getTime(), window.endExclusive.getTime()));

    if (endExclusive > start) {
      const capacityHours = countBusinessDays(start, endExclusive) * getPersonDailyHours(personName);
      // Soft bookings never reduce free capacity; they are reported separately.
      const assignedHours = assignmentsForPerson
        .filter((assignment) => assignment.IsCommitted)
        .reduce((total, assignment) => total + assignmentHoursInWindow(assignment, start, endExclusive), 0);
      const softHours = assignmentsForPerson
        .filter((assignment) => !assignment.IsCommitted)
        .reduce((total, assignment) => total + assignmentHoursInWindow(assignment, start, endExclusive), 0);

      segments.push({
        key: `${perspective}-${toDateText(cursor)}`,
        unitLabel: formatUnitLabel(cursor, perspective),
        groupLabel: unitGroup(cursor, perspective).label,
        start,
        endExclusive,
        capacityHours: round2(capacityHours),
        freeHours: round2(capacityHours - assignedHours),
        softHours: round2(softHours),
      });
    }

    cursor = nextUnit;
  }

  return segments;
}

function buildManagementPeople(assignmentRows, window) {
  const assignedPeople = assignmentRows.map((assignment) => assignment.PersonName).filter(Boolean);
  const businessDays = countBusinessDays(window.start, window.endExclusive);

  return [...new Set([...listPeople(), ...assignedPeople])].map((person) => {
    const dailyHours = getPersonDailyHours(person);
    const capacityHours = round2(businessDays * dailyHours);
    const assigned = assignmentRows.filter((assignment) => assignment.PersonName === person);
    const visible = assigned.filter((assignment) => assignment.IsTimelineVisible);

    const hoursIn = (rows) =>
      rows.reduce((total, assignment) => total + assignmentHoursInWindow(assignment, window.start, window.endExclusive), 0);

    // Only committed work consumes capacity; soft bookings are reported alongside it.
    const activeHours = hoursIn(visible.filter((assignment) => assignment.IsCommitted));
    const softHours = hoursIn(visible.filter((assignment) => !assignment.IsCommitted));

    const assignedPercent = capacityHours > 0 ? Math.min(100, Math.max(0, (activeHours / capacityHours) * 100)) : 0;
    const softPercent = capacityHours > 0 ? Math.min(100 - assignedPercent, Math.max(0, (softHours / capacityHours) * 100)) : 0;

    // Chargeability is reported uncapped so over-allocation stays visible.
    const chargeabilityReal = capacityHours > 0 ? round2((activeHours / capacityHours) * 100) : 0;
    const chargeabilityPredicted = capacityHours > 0 ? round2(((activeHours + softHours) / capacityHours) * 100) : 0;

    return {
      person,
      role: getPersonRole(person),
      assigned,
      dailyHours,
      capacityHours,
      activeHours: round2(activeHours),
      softHours: round2(softHours),
      availableHours: round2(capacityHours - activeHours),
      availableIfWonHours: round2(capacityHours - activeHours - softHours),
      assignedPercent,
      softPercent,
      availablePercent: Math.max(0, 100 - assignedPercent),
      chargeabilityReal,
      chargeabilityPredicted,
      chargeabilityClass: chargeabilityClass(chargeabilityReal),
      chargeabilityPredictedClass: chargeabilityClass(chargeabilityPredicted),
    };
  });
}

/**
 * Team-wide chargeability, weighted by capacity rather than averaged per head so
 * part-time people do not distort the number.
 */
function summariseChargeability(people) {
  const capacityHours = people.reduce((total, member) => total + member.capacityHours, 0);
  const activeHours = people.reduce((total, member) => total + member.activeHours, 0);
  const softHours = people.reduce((total, member) => total + member.softHours, 0);

  const real = capacityHours > 0 ? round2((activeHours / capacityHours) * 100) : 0;
  const predicted = capacityHours > 0 ? round2(((activeHours + softHours) / capacityHours) * 100) : 0;

  return {
    capacityHours: round2(capacityHours),
    activeHours: round2(activeHours),
    softHours: round2(softHours),
    real,
    predicted,
    realClass: chargeabilityClass(real),
    predictedClass: chargeabilityClass(predicted),
  };
}

/** Hold overlay position expressed relative to the chip it sits on. */
function holdOverlay(range, assignment, chipBox) {
  if (!assignment.IsOnHold || chipBox.width <= 0) return null;
  const box = chipGeometry(range, assignment.HoldStartDate, assignment.HoldEndDate, 0);
  if (box.width <= 0) return null;

  const left = ((box.left - chipBox.left) / chipBox.width) * 100;
  const width = (box.width / chipBox.width) * 100;
  const clampedLeft = Math.max(0, Math.min(100, left));

  return {
    left: clampedLeft,
    width: Math.max(0, Math.min(100 - clampedLeft, width)),
  };
}

/**
 * Builds the full view model for the Management page: capacity cards, assignment table,
 * and the positioned timeline chips.
 */
function buildManagementView({ opportunities, assignments, perspective, unitsToShow, stageFilter, personFilter }) {
  const assignmentRows = buildAssignmentRows(opportunities, assignments);
  const window = capacityWindow(perspective, unitsToShow);
  const allPeople = buildManagementPeople(assignmentRows, window);

  // An empty person filter means everyone; an unknown name simply matches nobody.
  const selectedPeople = (Array.isArray(personFilter) ? personFilter : personFilter ? [personFilter] : [])
    .map((name) => String(name))
    .filter(Boolean);
  const people = selectedPeople.length ? allPeople.filter((member) => selectedPeople.includes(member.person)) : allPeople;

  const visibleRows = assignmentRows.filter(
    (assignment) => !selectedPeople.length || selectedPeople.includes(assignment.PersonName)
  );
  const scheduled = visibleRows.filter((assignment) => assignment.IsTimelineVisible);

  // The filter accepts several stages at once; "free" is a pseudo-stage for the free bars.
  const selected = (Array.isArray(stageFilter) ? stageFilter : stageFilter ? [stageFilter] : [])
    .map((stage) => String(stage).toLowerCase())
    .filter(Boolean);
  const stagesOnly = selected.filter((stage) => stage !== 'free');
  const showFreeBars = selected.length === 0 || selected.includes('free');
  const displayed =
    selected.length === 0
      ? scheduled
      : stagesOnly.length === 0
        ? []
        : scheduled.filter((assignment) => stagesOnly.includes(String(assignment.Stage || '').toLowerCase()));

  const range = timelineRange(scheduled, perspective, unitsToShow);
  const units = buildTimelineUnits(range, perspective);
  const unitGroups = buildTimelineGroups(units);

  const byPersonAll = new Map();
  const byPersonDisplayed = new Map();
  scheduled.forEach((assignment) => {
    if (!byPersonAll.has(assignment.PersonName)) byPersonAll.set(assignment.PersonName, []);
    byPersonAll.get(assignment.PersonName).push(assignment);
  });
  displayed.forEach((assignment) => {
    if (!byPersonDisplayed.has(assignment.PersonName)) byPersonDisplayed.set(assignment.PersonName, []);
    byPersonDisplayed.get(assignment.PersonName).push(assignment);
  });

  const rows = people.map((member) => {
    const forPerson = (byPersonDisplayed.get(member.person) || [])
      .slice()
      .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));
    const allForPerson = (byPersonAll.get(member.person) || [])
      .slice()
      .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));

    const chips = forPerson.map((assignment, index) => {
      const geometry = chipGeometry(range, assignment.StartDate, assignment.EndDate, index);
      // Hours landing inside the visible window, which is what actually eats
      // capacity: committed hours here plus the free bars equal the person's
      // capacity for the window.
      const windowHours = round2(assignmentHoursInWindow(assignment, window.start, window.endExclusive));
      return {
        ...assignment,
        accentClass: stageAccentClass(assignment.Stage),
        geometry,
        hold: holdOverlay(range, assignment, geometry),
        businessDays: countBusinessDaysInclusive(assignment.StartDate, assignment.EndDate),
        windowHours,
        capacityPercent: member.capacityHours > 0 ? round2((windowHours / member.capacityHours) * 100) : 0,
      };
    });

    const freeChips = showFreeBars
      ? freeSegments(allForPerson, member.person, window, perspective).map((segment) => ({
          ...segment,
          geometry: freeGeometry(range, segment.start, segment.endExclusive, forPerson.length),
        }))
      : [];

    return {
      person: member.person,
      role: member.role,
      capacityHours: member.capacityHours,
      dailyHours: member.dailyHours,
      // committed + free = capacity, so the row always adds up to the window.
      committedHours: member.activeHours,
      softHours: member.softHours,
      freeHours: member.availableHours,
      chips,
      freeChips,
      height: rowHeight(forPerson.length, showFreeBars),
    };
  });

  const total = visibleRows.length;
  const visible = visibleRows.filter((assignment) => assignment.IsTimelineVisible).length;
  const committed = visibleRows.filter((assignment) => assignment.IsCommitted).length;
  const onHold = visibleRows.filter((assignment) => assignment.IsOnHold).length;

  return {
    assignmentRows,
    people,
    allPeople,
    chargeability: summariseChargeability(people),
    stats: { total, visible, hidden: total - visible, committed, soft: total - committed, onHold },
    timeline: {
      range,
      units,
      unitGroups,
      rows,
      perspective,
      showFreeBars,
      startText: toDateText(range.start),
      endExclusiveText: toDateText(range.endExclusive),
      windowStartText: toDateText(window.start),
      windowEndExclusiveText: toDateText(window.endExclusive),
    },
    window,
    capacityBusinessDays: countBusinessDays(window.start, window.endExclusive),
  };
}

/** Next steps due inside the selected period, for open opportunities only. */
function buildUpcoming(opportunities, periodKey, nextSteps) {
  const { start, endInclusive } = periodBounds(periodKey);
  const endMs = endInclusive.getTime();

  const open = opportunities.filter((item) => item.Status !== 'Closed');
  const openIds = new Set(open.map((item) => String(item.Id)));

  // The dedicated next-step list is the source of truth; the legacy summary
  // columns are still read so data captured before they were removed shows up.
  const fromSteps = (Array.isArray(nextSteps) ? nextSteps : [])
    .filter((step) => openIds.size === 0 || openIds.has(String(step.OpportunityId)))
    .map((step) => ({
      id: step.OpportunityId,
      name: step.OpportunityName,
      stage: step.Stage || 'Unspecified',
      summary: step.Title || 'Untitled next step',
      due: toDate(step.DueDate),
    }));

  const withStepIds = new Set(fromSteps.map((item) => String(item.id)));
  const fromLegacy = open
    .filter((item) => item.NextStepSummary && !withStepIds.has(String(item.Id)))
    .map((item) => ({
      id: item.Id,
      name: item.Name,
      stage: item.Stage || 'Unspecified',
      summary: item.NextStepSummary,
      due: toDate(item.NextStepDueDate),
    }));

  const items = [...fromSteps, ...fromLegacy]
    .filter((item) => item.due && item.due >= start && item.due.getTime() <= endMs)
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .map((item) => ({ ...item, dueText: toDateText(item.due) }));

  return { items, label: `${formatShortDate(start)} - ${formatShortDate(endInclusive)}` };
}

module.exports = {
  HOURS_PER_DAY,
  TIMELINE_UNIT_OPTIONS,
  STAGE_LEGEND,
  UPCOMING_PERIODS,
  stageStatusLabel,
  stageAccentClass,
  stageBadgeClass,
  capacityClass,
  chargeabilityClass,
  buildAssignmentRows,
  assignmentHoursInWindow,
  buildManagementView,
  buildUpcoming,
};
