const {
  HOURS_PER_DAY,
  round2,
  toDate,
  toDateText,
  parseDateOnlyUtc,
  countBusinessDays,
  countBusinessDaysInclusive,
  startOfUnit,
  addUnit,
  formatUnitLabel,
  unitGroup,
  formatShortDate,
  unitsToCoverRange,
  periodBounds,
  addBusinessDaysText,
} = require('./dateService');
const { listPeople, getPersonDailyHours, getPersonRole, getPersonCost, COST_CURRENCY } = require('./peopleService');
const { absenceBusinessDays, absencesInWindow } = require('./absenceService');
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

/** Sortable columns of the Management assignments table, in display order. */
const ASSIGNMENT_SORT_FIELDS = [
  { key: 'person', label: 'Person', type: 'text', value: (row) => row.PersonName },
  { key: 'opportunity', label: 'Opportunity', type: 'text', value: (row) => row.OpportunityName },
  { key: 'stage', label: 'Stage', type: 'text', value: (row) => stageStatusLabel(row.Stage) },
  { key: 'start', label: 'Window', type: 'text', value: (row) => row.StartDate || '' },
  { key: 'allocation', label: 'Project Allocation', type: 'number', value: (row) => Number(row.InitialPercent || 0) },
  { key: 'hours', label: 'Hours', type: 'number', value: (row) => Number(row.AllocatedHours || 0) },
  { key: 'booking', label: 'Booking', type: 'text', value: (row) => (row.IsCommitted ? 'Committed' : 'Soft') },
  { key: 'timeline', label: 'Timeline', type: 'text', value: (row) => (row.IsTimelineVisible ? 'Shown' : 'Hidden') },
];

/** Sortable fields of the People summary, which also orders the timeline rows. */
const PEOPLE_SORT_FIELDS = [
  { key: 'person', label: 'Name', type: 'text', value: (member) => member.person },
  { key: 'role', label: 'Role', type: 'text', value: (member) => member.role || '' },
  { key: 'daily', label: 'Hours per day', type: 'number', value: (member) => member.dailyHours },
  { key: 'capacity', label: 'Capacity', type: 'number', value: (member) => member.capacityHours },
  { key: 'committed', label: 'Committed hours', type: 'number', value: (member) => member.activeHours },
  { key: 'soft', label: 'Soft booked hours', type: 'number', value: (member) => member.softHours },
  { key: 'free', label: 'Free hours', type: 'number', value: (member) => member.availableHours },
  { key: 'held', label: 'Hours on hold', type: 'number', value: (member) => member.heldHours },
  { key: 'absence', label: 'Absence hours', type: 'number', value: (member) => member.absenceHours },
  { key: 'real', label: 'Chargeability (real)', type: 'number', value: (member) => member.chargeabilityReal },
  { key: 'predicted', label: 'Chargeability (predicted)', type: 'number', value: (member) => member.chargeabilityPredicted },
];

/** Falls back to the first field, so an unknown or absent key still sorts predictably. */
function resolveSort(fields, key, dir) {
  const field = fields.find((candidate) => candidate.key === String(key || '')) || fields[0];
  return { key: field.key, dir: String(dir) === 'desc' ? 'desc' : 'asc', field };
}

/**
 * Orders rows by one field, keeping the original order for ties so repeated
 * sorts on the same key stay stable.
 */
function sortBy(rows, fields, key, dir) {
  const { field, dir: direction } = resolveSort(fields, key, dir);
  const sign = direction === 'desc' ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = field.value(a.row);
      const right = field.value(b.row);
      let comparison;
      if (field.type === 'number') {
        comparison = (Number(left) || 0) - (Number(right) || 0);
      } else {
        comparison = String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
      }
      return comparison !== 0 ? comparison * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
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

  const rows = assignments
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

  return rows.map((row) => ({ ...row, scope: opportunityScope(rows, row.OpportunityId, row.OpportunityHours) }));
}

/**
 * How much of an opportunity's scope its assignments have taken.
 *
 * Compared against the hours the bars actually carry, so broadening a bar on
 * the timeline can push an opportunity over its own budget and say so. An
 * opportunity with no stated hours cannot be over or under, so it is neutral.
 */
function opportunityScope(rows, opportunityId, opportunityHours) {
  const mine = rows.filter((row) => row.OpportunityId === opportunityId);
  const assignedHours = round2(mine.reduce((total, row) => total + Number(row.AllocatedHours || 0), 0));
  const scopeHours = round2(Number(opportunityHours || 0));
  const differenceHours = round2(assignedHours - scopeHours);

  if (scopeHours <= 0) {
    return {
      assignedHours,
      scopeHours,
      differenceHours: 0,
      percentOfScope: 0,
      assignmentCount: mine.length,
      state: 'unknown',
    };
  }

  return {
    assignedHours,
    scopeHours,
    differenceHours,
    percentOfScope: round2((assignedHours / scopeHours) * 100),
    assignmentCount: mine.length,
    // A hair over from rounding is not an overrun worth flagging in red.
    state: differenceHours > 0.01 ? 'over' : 'within',
  };
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
 * without changing the assignment's stored total. Pass `ignoreHolds` to get the
 * figure the assignment *would* consume if it were not paused, which is what the
 * hold-impact reporting compares against.
 */
function assignmentHoursInWindow(assignment, windowStart, windowEndExclusive, options) {
  const ignoreHolds = !!(options && options.ignoreHolds);
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
  const activeBusinessDays = ignoreHolds
    ? overlapBusinessDays
    : overlapBusinessDays - heldBusinessDays(assignment, overlapStart, overlapEndExclusive);
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

/**
 * A person's real capacity for a period: their working days in it, less the days
 * they are absent, at their daily rate.
 *
 * Absence removes the days themselves, so it shrinks capacity rather than
 * freeing it. That is the opposite of an allocation hold, which leaves capacity
 * intact and hands back the hours one assignment was consuming.
 */
function personCapacity(personName, start, endExclusive) {
  const dailyHours = getPersonDailyHours(personName);
  const businessDays = countBusinessDays(start, endExclusive);
  const absentDays = Math.min(businessDays, absenceBusinessDays(personName, start, endExclusive));

  return {
    dailyHours,
    businessDays,
    absentDays,
    workingDays: businessDays - absentDays,
    grossHours: round2(businessDays * dailyHours),
    absenceHours: round2(absentDays * dailyHours),
    hours: round2((businessDays - absentDays) * dailyHours),
  };
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
 *
 * Each segment also carries the share of that column's capacity taken by each
 * committed assignment, so the committed shares plus the free share are 100%.
 */
function freeSegments(assignmentsForPerson, personName, window, perspective) {
  const segments = [];
  let cursor = startOfUnit(window.start, perspective);

  while (cursor < window.endExclusive) {
    const nextUnit = addUnit(cursor, perspective, 1);
    const start = new Date(Math.max(cursor.getTime(), window.start.getTime()));
    const endExclusive = new Date(Math.min(nextUnit.getTime(), window.endExclusive.getTime()));

    if (endExclusive > start) {
      const capacity = personCapacity(personName, start, endExclusive);
      const capacityHours = capacity.hours;
      const share = (hours) => (capacityHours > 0 ? round2((hours / capacityHours) * 100) : 0);

      // Soft bookings never reduce free capacity; they are reported separately.
      const committed = assignmentsForPerson.filter((assignment) => assignment.IsCommitted);
      const parts = committed
        .map((assignment) => ({
          name: assignment.OpportunityName,
          hours: round2(assignmentHoursInWindow(assignment, start, endExclusive)),
          percent: share(assignmentHoursInWindow(assignment, start, endExclusive)),
        }))
        .filter((part) => part.hours > 0);

      const assignedHours = committed.reduce(
        (total, assignment) => total + assignmentHoursInWindow(assignment, start, endExclusive),
        0
      );
      const softHours = assignmentsForPerson
        .filter((assignment) => !assignment.IsCommitted)
        .reduce((total, assignment) => total + assignmentHoursInWindow(assignment, start, endExclusive), 0);

      const freeHours = capacityHours - assignedHours;

      segments.push({
        key: `${perspective}-${toDateText(cursor)}`,
        unitLabel: formatUnitLabel(cursor, perspective),
        groupLabel: unitGroup(cursor, perspective).label,
        start,
        endExclusive,
        capacityHours: round2(capacityHours),
        freeHours: round2(freeHours),
        softHours: round2(softHours),
        parts,
        // Reported against the same capacity base, so used + free is always 100%.
        usedPercent: share(assignedHours),
        freePercent: share(freeHours),
        softPercent: share(softHours),
        // Absence is shown against the days it removed, not as a share of what
        // is left, since the remaining capacity is exactly what 100% now means.
        absenceHours: capacity.absenceHours,
        absentDays: capacity.absentDays,
        grossCapacityHours: capacity.grossHours,
        absences: capacity.absentDays > 0 ? absencesInWindow(personName, start, endExclusive) : [],
      });
    }

    cursor = nextUnit;
  }

  return segments;
}

/**
 * A person's absences as bands across the timeline, so time away is visible
 * against the assignment chips rather than only inside the free-bar tooltip.
 *
 * Bands are drawn over the whole row height because an absence applies to the
 * person, not to one assignment: every chip it crosses is affected.
 */
function absenceBands(personName, range) {
  const rangeEndInclusive = new Date(range.endExclusive.getTime() - DAY_MS);
  return absencesInWindow(personName, range.start, range.endExclusive).map((absence) => {
    // Clip the label dates to the visible range so a long absence that starts
    // before the window still reads correctly.
    const geometry = chipGeometry(range, absence.startDate, absence.endDate, 0);
    return {
      ...absence,
      geometry,
      startsBefore: absence.startDate < toDateText(range.start),
      endsAfter: absence.endDate > toDateText(rangeEndInclusive),
    };
  }).filter((band) => band.geometry.width > 0);
}

function buildManagementPeople(assignmentRows, window) {
  const assignedPeople = assignmentRows.map((assignment) => assignment.PersonName).filter(Boolean);

  return [...new Set([...listPeople(), ...assignedPeople])].map((person) => {
    const capacity = personCapacity(person, window.start, window.endExclusive);
    const dailyHours = capacity.dailyHours;
    const capacityHours = capacity.hours;
    const assigned = assignmentRows.filter((assignment) => assignment.PersonName === person);
    const visible = assigned.filter((assignment) => assignment.IsTimelineVisible);

    const hoursIn = (rows, options) =>
      rows.reduce(
        (total, assignment) => total + assignmentHoursInWindow(assignment, window.start, window.endExclusive, options),
        0
      );

    // Only committed work consumes capacity; soft bookings are reported alongside it.
    const activeHours = hoursIn(visible.filter((assignment) => assignment.IsCommitted));
    const softHours = hoursIn(visible.filter((assignment) => !assignment.IsCommitted));

    // What the committed work would consume if none of it were paused. The
    // difference is the capacity that holds hand back for this window.
    const heldRows = visible.filter((assignment) => assignment.IsCommitted && assignment.IsOnHold);
    const activeIgnoringHolds = activeHours + (hoursIn(heldRows, { ignoreHolds: true }) - hoursIn(heldRows));
    const heldHours = round2(Math.max(0, activeIgnoringHolds - activeHours));

    const assignedPercent = capacityHours > 0 ? Math.min(100, Math.max(0, (activeHours / capacityHours) * 100)) : 0;
    const softPercent = capacityHours > 0 ? Math.min(100 - assignedPercent, Math.max(0, (softHours / capacityHours) * 100)) : 0;

    // Chargeability is reported uncapped so over-allocation stays visible.
    const chargeabilityReal = capacityHours > 0 ? round2((activeHours / capacityHours) * 100) : 0;
    const chargeabilityPredicted = capacityHours > 0 ? round2(((activeHours + softHours) / capacityHours) * 100) : 0;
    const chargeabilityWithoutHolds = capacityHours > 0 ? round2((activeIgnoringHolds / capacityHours) * 100) : 0;

    // Absence does not change the hours anyone owes, only the days available to
    // deliver them, so the same committed hours over a smaller base read as
    // higher utilization. Comparing against the gross base says by how much.
    const chargeabilityWithoutAbsence =
      capacity.grossHours > 0 ? round2((activeHours / capacity.grossHours) * 100) : 0;

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
      // Hold reporting: how much capacity is released, and what utilization
      // would look like if the paused work were running.
      heldHours,
      heldAssignments: heldRows.length,
      chargeabilityWithoutHolds,
      holdPercentPoints: round2(Math.max(0, chargeabilityWithoutHolds - chargeabilityReal)),
      // Absence reporting: the days and hours removed from the window, and the
      // utilization difference that removal makes.
      absentDays: capacity.absentDays,
      absenceHours: capacity.absenceHours,
      grossCapacityHours: capacity.grossHours,
      absences: capacity.absentDays > 0 ? absencesInWindow(person, window.start, window.endExclusive) : [],
      chargeabilityWithoutAbsence,
      absencePercentPoints: round2(Math.max(0, chargeabilityReal - chargeabilityWithoutAbsence)),
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
  const grossCapacityHours = people.reduce((total, member) => total + member.grossCapacityHours, 0);
  const activeHours = people.reduce((total, member) => total + member.activeHours, 0);
  const softHours = people.reduce((total, member) => total + member.softHours, 0);
  const absenceHours = people.reduce((total, member) => total + member.absenceHours, 0);

  const real = capacityHours > 0 ? round2((activeHours / capacityHours) * 100) : 0;
  const predicted = capacityHours > 0 ? round2(((activeHours + softHours) / capacityHours) * 100) : 0;
  const withoutAbsence = grossCapacityHours > 0 ? round2((activeHours / grossCapacityHours) * 100) : 0;

  return {
    capacityHours: round2(capacityHours),
    grossCapacityHours: round2(grossCapacityHours),
    activeHours: round2(activeHours),
    softHours: round2(softHours),
    absenceHours: round2(absenceHours),
    absentPeople: people.filter((member) => member.absentDays > 0).length,
    real,
    predicted,
    withoutAbsence,
    absencePercentPoints: round2(Math.max(0, real - withoutAbsence)),
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
function buildManagementView({
  opportunities,
  assignments,
  perspective,
  unitsToShow,
  stageFilter,
  statusFilter,
  personFilter,
  sort,
  dir,
  peopleSort,
  peopleDir,
}) {
  const assignmentRows = buildAssignmentRows(opportunities, assignments);
  const window = capacityWindow(perspective, unitsToShow);
  const allPeople = buildManagementPeople(assignmentRows, window);

  // An empty person filter means everyone; an unknown name simply matches nobody.
  const selectedPeople = (Array.isArray(personFilter) ? personFilter : personFilter ? [personFilter] : [])
    .map((name) => String(name))
    .filter(Boolean);
  const people = sortBy(
    selectedPeople.length ? allPeople.filter((member) => selectedPeople.includes(member.person)) : allPeople,
    PEOPLE_SORT_FIELDS,
    peopleSort,
    peopleDir
  );

  // Status narrows which assignments are in play at all, so it applies before
  // the stage filter, which only decides what the timeline draws.
  const selectedStatuses = (Array.isArray(statusFilter) ? statusFilter : statusFilter ? [statusFilter] : [])
    .map((status) => String(status).toLowerCase())
    .filter(Boolean);
  const matchesStatus = (assignment) =>
    !selectedStatuses.length || selectedStatuses.includes(String(assignment.Status || '').toLowerCase());

  const visibleRows = assignmentRows.filter(
    (assignment) =>
      (!selectedPeople.length || selectedPeople.includes(assignment.PersonName)) && matchesStatus(assignment)
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
      heldHours: member.heldHours,
      absenceHours: member.absenceHours,
      absentDays: member.absentDays,
      chips,
      freeChips,
      absenceBands: absenceBands(member.person, range),
      height: rowHeight(forPerson.length, showFreeBars),
    };
  });

  const total = visibleRows.length;
  const visible = visibleRows.filter((assignment) => assignment.IsTimelineVisible).length;
  const committed = visibleRows.filter((assignment) => assignment.IsCommitted).length;
  const onHold = visibleRows.filter((assignment) => assignment.IsOnHold).length;

  return {
    // The table shows what the page filters select, so "Assignments" always
    // means the same set the timeline above is drawing from.
    assignmentRows: sortBy(visibleRows, ASSIGNMENT_SORT_FIELDS, sort, dir),
    sort: resolveSort(ASSIGNMENT_SORT_FIELDS, sort, dir),
    peopleSort: resolveSort(PEOPLE_SORT_FIELDS, peopleSort, peopleDir),
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

/**
 * Absences that land inside the delivery windows of an opportunity's assignments.
 *
 * The point of view here is the project, not the person: an absence only matters
 * to an opportunity if the person is away on days that assignment was counting
 * on. Days lost are converted to hours at the assignment's own delivery rate
 * (its hours spread over its working days), because that is what actually slips.
 *
 * Nothing here changes a stored figure. It is advice: the assignment still owes
 * its hours, so either the window has to stretch or the hours have to move to
 * someone else.
 */
function buildOpportunityAbsenceImpact(opportunity, assignments) {
  const scopeHours = Number((opportunity && opportunity.OpportunityHours) || 0);

  const items = (Array.isArray(assignments) ? assignments : [])
    .map((assignment) => {
      const startText = toDateText(assignment.PlannedStartDate);
      const endText = toDateText(assignment.PlannedEndDate);
      const start = parseDateOnlyUtc(startText);
      const end = parseDateOnlyUtc(endText);
      if (!start || !end || end < start) return null;

      const endExclusive = new Date(end.getTime() + DAY_MS);
      const absences = absencesInWindow(assignment.PersonName, start, endExclusive);
      if (!absences.length) return null;

      const businessDays = countBusinessDaysInclusive(startText, endText);
      const absentDays = Math.min(businessDays, absenceBusinessDays(assignment.PersonName, start, endExclusive));
      if (!businessDays || !absentDays) return null;

      const allocatedHours = round2(Number(assignment.AllocatedHours || 0));
      const hoursAtRisk = round2(allocatedHours * (absentDays / businessDays));
      const workingDays = businessDays - absentDays;

      return {
        assignmentId: assignment.Id,
        person: assignment.PersonName,
        startDate: startText,
        endDate: endText,
        businessDays,
        absentDays,
        workingDays,
        allocatedHours,
        hoursAtRisk,
        percentOfAssignment: allocatedHours > 0 ? round2((hoursAtRisk / allocatedHours) * 100) : 0,
        percentOfScope: scopeHours > 0 ? round2((hoursAtRisk / scopeHours) * 100) : 0,
        // Recovering the lost days means running that many working days longer.
        suggestedEndDate: addBusinessDaysText(endText, absentDays),
        // No working days left at all means the window cannot deliver anything.
        blocksDelivery: workingDays === 0,
        absences,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hoursAtRisk - a.hoursAtRisk || a.startDate.localeCompare(b.startDate));

  const hoursAtRisk = round2(items.reduce((total, item) => total + item.hoursAtRisk, 0));
  const daysLost = items.reduce((total, item) => total + item.absentDays, 0);
  const latestSuggestedEnd = items.reduce(
    (latest, item) => (item.suggestedEndDate > latest ? item.suggestedEndDate : latest),
    ''
  );
  const plannedEnd = toDateText(opportunity && opportunity.PlannedEndDate);

  return {
    items,
    hoursAtRisk,
    daysLost,
    peopleAffected: [...new Set(items.map((item) => item.person))],
    percentOfScope: scopeHours > 0 ? round2((hoursAtRisk / scopeHours) * 100) : 0,
    scopeHours: round2(scopeHours),
    blocksDelivery: items.some((item) => item.blocksDelivery),
    plannedEndDate: plannedEnd,
    latestSuggestedEnd,
    // Only a real slip past the planned end is worth calling out as a date risk.
    shiftsPlannedEnd: !!(plannedEnd && latestSuggestedEnd && latestSuggestedEnd > plannedEnd),
  };
}

/**
 * Everything the person detail page needs: one member's capacity broken down by
 * the columns of the selected perspective, plus the assignments behind it.
 *
 * Per period the committed hours plus the free hours equal capacity, and per
 * assignment the hours are the portion falling inside that period, so the
 * figures reconcile with the timeline bars.
 */
function buildPersonDetail({ opportunities, assignments, perspective, unitsToShow, person }) {
  const name = String(person || '');
  const assignmentRows = buildAssignmentRows(opportunities, assignments);
  const window = capacityWindow(perspective, unitsToShow);
  const member = buildManagementPeople(assignmentRows, window).find((candidate) => candidate.person === name) || null;

  const mine = assignmentRows
    .filter((assignment) => assignment.PersonName === name)
    .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));
  const visible = mine.filter((assignment) => assignment.IsTimelineVisible);

  const periods = freeSegments(visible, name, window, perspective).map((segment) => {
    const softInPeriod = visible
      .filter((assignment) => !assignment.IsCommitted)
      .reduce((total, a) => total + assignmentHoursInWindow(a, segment.start, segment.endExclusive), 0);

    return {
      key: segment.key,
      label: segment.unitLabel,
      groupLabel: segment.groupLabel,
      startText: toDateText(segment.start),
      endText: toDateText(new Date(segment.endExclusive.getTime() - DAY_MS)),
      businessDays: countBusinessDays(segment.start, segment.endExclusive),
      capacityHours: segment.capacityHours,
      committedHours: round2(segment.capacityHours - segment.freeHours),
      freeHours: segment.freeHours,
      softHours: round2(softInPeriod),
      usedPercent: segment.usedPercent,
      freePercent: segment.freePercent,
      softPercent: segment.softPercent,
      absenceHours: segment.absenceHours,
      absentDays: segment.absentDays,
      absences: segment.absences,
      parts: segment.parts,
    };
  });

  // Per-assignment figures for the selected window, which is what the person is
  // actually being asked to deliver in the period on screen.
  const rows = mine.map((assignment) => {
    const windowHours = round2(assignmentHoursInWindow(assignment, window.start, window.endExclusive));
    const withoutHold = round2(
      assignmentHoursInWindow(assignment, window.start, window.endExclusive, { ignoreHolds: true })
    );
    const capacityHours = member ? member.capacityHours : 0;

    return {
      ...assignment,
      windowHours,
      releasedByHoldHours: round2(Math.max(0, withoutHold - windowHours)),
      capacityPercent: capacityHours > 0 ? round2((windowHours / capacityHours) * 100) : 0,
      businessDays: countBusinessDaysInclusive(assignment.StartDate, assignment.EndDate),
      accentClass: stageAccentClass(assignment.Stage),
    };
  });

  const inWindow = rows.filter((row) => row.windowHours > 0 || row.releasedByHoldHours > 0);

  return {
    person: name,
    isKnown: !!member,
    member,
    cost: getPersonCost(name),
    costCurrency: COST_CURRENCY,
    periods,
    rows,
    inWindow,
    outsideWindow: rows.filter((row) => !inWindow.includes(row)),
    hiddenCount: mine.length - visible.length,
    window,
    perspective,
    unitsToShow,
    windowStartText: toDateText(window.start),
    windowEndText: toDateText(new Date(window.endExclusive.getTime() - DAY_MS)),
    capacityBusinessDays: countBusinessDays(window.start, window.endExclusive),
    absences: absencesInWindow(name, window.start, window.endExclusive),
  };
}

module.exports = {
  HOURS_PER_DAY,
  TIMELINE_UNIT_OPTIONS,
  STAGE_LEGEND,
  UPCOMING_PERIODS,
  ASSIGNMENT_SORT_FIELDS,
  PEOPLE_SORT_FIELDS,
  stageStatusLabel,
  stageAccentClass,
  stageBadgeClass,
  capacityClass,
  chargeabilityClass,
  sortBy,
  buildAssignmentRows,
  assignmentHoursInWindow,
  personCapacity,
  freeSegments,
  buildManagementView,
  buildPersonDetail,
  buildUpcoming,
  buildOpportunityAbsenceImpact,
  opportunityScope,
};
