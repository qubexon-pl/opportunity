const {
  HOURS_PER_DAY,
  round2,
  toDate,
  toDateText,
  countBusinessDays,
  startOfUnit,
  addUnit,
  formatUnitLabel,
  formatMonthLabel,
  formatShortDate,
  startOfMonth,
  addMonths,
  unitsToCoverRange,
  periodBounds,
} = require('./dateService');
const { listPeople, getPersonDailyHours } = require('./peopleService');

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

/** Joins assignments with their opportunity, filling in derived hours. */
function buildAssignmentRows(opportunities, assignments) {
  const byId = new Map(opportunities.map((o) => [o.Id, o]));

  return assignments
    .map((assignment) => {
      const opportunity = byId.get(assignment.OpportunityId);
      if (!opportunity) return null;
      const allocated = Number(assignment.AllocatedHours);
      const fallback = round2(Number(opportunity.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100));
      return {
        ...assignment,
        OpportunityName: opportunity.Name,
        Stage: opportunity.Stage,
        Status: opportunity.Status,
        OpportunityHours: Number(opportunity.OpportunityHours || 0),
        AllocatedHours: Number.isFinite(allocated) ? allocated : fallback,
        StartDate: toDateText(assignment.PlannedStartDate),
        EndDate: toDateText(assignment.PlannedEndDate),
        IsTimelineVisible: !!assignment.IsTimelineVisible,
      };
    })
    .filter(Boolean);
}

/** Portion of an assignment's hours that falls inside [windowStart, windowEndExclusive). */
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
  if (totalBusinessDays <= 0 || overlapBusinessDays <= 0) return 0;

  const allocated = Number(assignment.AllocatedHours);
  const fallback = Number(assignment.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100);
  const totalHours = Number.isFinite(allocated) ? allocated : fallback;
  return totalHours * (overlapBusinessDays / totalBusinessDays);
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
    return {
      key: `${perspective}-${toDateText(unitStart)}`,
      label: formatUnitLabel(unitStart, perspective),
    };
  });
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

function monthlyFreeSegments(assignmentsForPerson, personName, window) {
  const segments = [];
  let monthCursor = startOfMonth(window.start);

  while (monthCursor < window.endExclusive) {
    const nextMonth = addMonths(monthCursor, 1);
    const start = new Date(Math.max(monthCursor.getTime(), window.start.getTime()));
    const endExclusive = new Date(Math.min(nextMonth.getTime(), window.endExclusive.getTime()));

    if (endExclusive > start) {
      const capacityHours = countBusinessDays(start, endExclusive) * getPersonDailyHours(personName);
      const assignedHours = assignmentsForPerson.reduce(
        (total, assignment) => total + assignmentHoursInWindow(assignment, start, endExclusive),
        0
      );
      segments.push({
        key: `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`,
        monthLabel: formatMonthLabel(monthCursor),
        start,
        endExclusive,
        capacityHours: round2(capacityHours),
        freeHours: round2(capacityHours - assignedHours),
      });
    }

    monthCursor = nextMonth;
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
    const activeHours = visible.reduce(
      (total, assignment) => total + assignmentHoursInWindow(assignment, window.start, window.endExclusive),
      0
    );
    const assignedPercent = capacityHours > 0 ? Math.min(100, Math.max(0, (activeHours / capacityHours) * 100)) : 0;

    return {
      person,
      assigned,
      dailyHours,
      capacityHours,
      activeHours: round2(activeHours),
      availableHours: round2(capacityHours - activeHours),
      assignedPercent,
      availablePercent: Math.max(0, 100 - assignedPercent),
    };
  });
}

/**
 * Builds the full view model for the Management page: capacity cards, assignment table,
 * and the positioned timeline chips.
 */
function buildManagementView({ opportunities, assignments, perspective, unitsToShow, stageFilter }) {
  const assignmentRows = buildAssignmentRows(opportunities, assignments);
  const window = capacityWindow(perspective, unitsToShow);
  const people = buildManagementPeople(assignmentRows, window);

  const scheduled = assignmentRows.filter((assignment) => assignment.IsTimelineVisible);
  const normalizedStage = String(stageFilter || '').toLowerCase();
  const showFreeBars = normalizedStage === '' || normalizedStage === 'free';
  const displayed =
    normalizedStage === 'free'
      ? []
      : normalizedStage
        ? scheduled.filter((assignment) => String(assignment.Stage || '').toLowerCase() === normalizedStage)
        : scheduled;

  const range = timelineRange(scheduled, perspective, unitsToShow);
  const units = buildTimelineUnits(range, perspective);

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

    const chips = forPerson.map((assignment, index) => ({
      ...assignment,
      accentClass: stageAccentClass(assignment.Stage),
      geometry: chipGeometry(range, assignment.StartDate, assignment.EndDate, index),
    }));

    const freeChips = showFreeBars
      ? monthlyFreeSegments(allForPerson, member.person, window).map((segment) => ({
          ...segment,
          geometry: freeGeometry(range, segment.start, segment.endExclusive, forPerson.length),
        }))
      : [];

    return {
      person: member.person,
      chips,
      freeChips,
      height: rowHeight(forPerson.length, showFreeBars),
    };
  });

  const total = assignmentRows.length;
  const visible = assignmentRows.filter((assignment) => assignment.IsTimelineVisible).length;

  return {
    assignmentRows,
    people,
    stats: { total, visible, hidden: total - visible },
    timeline: {
      range,
      units,
      rows,
      showFreeBars,
      startText: toDateText(range.start),
      endExclusiveText: toDateText(range.endExclusive),
    },
    window,
    capacityBusinessDays: countBusinessDays(window.start, window.endExclusive),
  };
}

/** Next steps due inside the selected period, for open opportunities only. */
function buildUpcoming(opportunities, periodKey) {
  const { start, endInclusive } = periodBounds(periodKey);
  const endMs = endInclusive.getTime();

  const items = opportunities
    .filter((item) => item.Status !== 'Closed')
    .map((item) => ({
      id: item.Id,
      name: item.Name,
      stage: item.Stage || 'Unspecified',
      summary: item.NextStepSummary || 'No next step summary',
      due: toDate(item.NextStepDueDate),
    }))
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
  buildAssignmentRows,
  assignmentHoursInWindow,
  buildManagementView,
  buildUpcoming,
};
