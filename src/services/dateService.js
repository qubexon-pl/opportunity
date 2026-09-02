const MONTHLY_CAPACITY = 160;
const WORK_DAYS_PER_MONTH = 20;
const HOURS_PER_DAY = MONTHLY_CAPACITY / WORK_DAYS_PER_MONTH;

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateText(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function parseDateOnlyUtc(value) {
  if (!value || typeof value !== 'string') return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Counts Mon-Fri days in [startDate, endExclusive). Boundaries are UTC midnight. */
function countBusinessDays(startDate, endExclusive) {
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor < endExclusive) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function countBusinessDaysInclusive(startDateText, endDateText) {
  const start = parseDateOnlyUtc(String(startDateText || '').slice(0, 10));
  const end = parseDateOnlyUtc(String(endDateText || '').slice(0, 10));
  if (!start || !end || end < start) return 0;

  let businessDays = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) businessDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return businessDays;
}

function countMonthsInclusive(startDateText, endDateText) {
  const start = toDate(startDateText);
  const end = toDate(endDateText);
  if (!start || !end || end < start) return 0;
  let months = (end.getFullYear() - start.getFullYear()) * 12;
  months += end.getMonth() - start.getMonth();
  return months + 1;
}

function addBusinessDays(date, daysToAdd) {
  const result = new Date(date);
  let remaining = Math.max(0, daysToAdd);
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

function calculateDurationWorkDays(hours, allocationPercent) {
  const percent = Number(allocationPercent || 100);
  const totalHours = Number(hours || 0);
  if (percent <= 0 || totalHours <= 0) return null;
  const dailyHours = HOURS_PER_DAY * (percent / 100);
  if (dailyHours <= 0) return null;
  return Math.max(1, Math.ceil(totalHours / dailyHours));
}

function calculateEndDate(startDateValue, hours, allocationPercent) {
  const startDate = toDate(startDateValue);
  if (!startDate) return null;
  const workDays = calculateDurationWorkDays(hours, allocationPercent);
  if (!workDays) return null;
  return toDateText(addBusinessDays(startDate, workDays - 1));
}

function calculateAllocatedHours(opportunityHours, allocationPercent) {
  return round2(Number(opportunityHours || 0) * (Number(allocationPercent || 0) / 100));
}

function calculateAllocatedHoursByDuration(plannedStartDate, plannedEndDate, allocationPercent) {
  const businessDays = countBusinessDaysInclusive(plannedStartDate, plannedEndDate);
  const pct = Number(allocationPercent || 0);
  if (businessDays <= 0 || pct <= 0) return 0;
  return round2(businessDays * HOURS_PER_DAY * (pct / 100));
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Unit boundaries are built at UTC midnight, matching how every stored date is
 * parsed. Building them in local time instead put the rendered window text a day
 * out east of Greenwich, and left bar geometry skewed by the UTC offset.
 */
function startOfIsoWeek(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function startOfUnit(date, perspective) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  if (perspective === 'weeks') return startOfIsoWeek(d);
  if (perspective === 'quarters') {
    d.setUTCDate(1);
    d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3);
    return d;
  }
  if (perspective === 'halfyears') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() < 6 ? 0 : 6);
    return d;
  }
  d.setUTCDate(1);
  return d;
}

function addUnit(date, perspective, units) {
  const d = new Date(date);
  if (perspective === 'weeks') {
    d.setUTCDate(d.getUTCDate() + units * 7);
    return d;
  }
  if (perspective === 'quarters') {
    d.setUTCMonth(d.getUTCMonth() + units * 3);
    return d;
  }
  if (perspective === 'halfyears') {
    d.setUTCMonth(d.getUTCMonth() + units * 6);
    return d;
  }
  d.setUTCMonth(d.getUTCMonth() + units);
  return d;
}

function formatUnitLabel(date, perspective) {
  if (perspective === 'weeks') {
    return formatWeekRangeLabel(date);
  }
  if (perspective === 'quarters') {
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${String(date.getUTCFullYear()).slice(-2)}`;
  }
  if (perspective === 'halfyears') {
    return `${date.getUTCMonth() < 6 ? 'H1' : 'H2'} ${String(date.getUTCFullYear()).slice(-2)}`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
function ordinal(day) {
  const n = Number(day);
  const remainderTen = n % 10;
  const remainderHundred = n % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${n}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${n}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${n}rd`;
  return `${n}th`;
}

/** A week column reads as its day range, e.g. "22nd - 28th". */
function formatWeekRangeLabel(weekStart) {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${ordinal(weekStart.getUTCDate())} - ${ordinal(end.getUTCDate())}`;
}

/**
 * The band shown above the unit columns: weeks are grouped by month, longer
 * units by year, so a column always says which period it belongs to.
 */
function unitGroup(date, perspective) {
  if (perspective === 'weeks') {
    return {
      key: `${date.getUTCFullYear()}-${date.getUTCMonth()}`,
      label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }
  return { key: String(date.getUTCFullYear()), label: String(date.getUTCFullYear()) };
}

function formatMonthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

function unitsToCoverRange(startDate, endDate, perspective) {
  let units = 0;
  let cursor = new Date(startDate);
  const target = new Date(endDate);
  while (cursor <= target && units < 240) {
    cursor = addUnit(cursor, perspective, 1);
    units += 1;
  }
  return Math.max(1, units);
}

/** Period bounds used by the "upcoming actions" panel on the pipeline page. */
function periodBounds(key) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (key === 'next-14') {
    const end = new Date(today);
    end.setDate(end.getDate() + 14);
    return { start: today, endInclusive: end };
  }
  if (key === 'this-month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start, endInclusive: end };
  }
  const start = startOfIsoWeek(today);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, endInclusive: end };
}

module.exports = {
  MONTHLY_CAPACITY,
  WORK_DAYS_PER_MONTH,
  HOURS_PER_DAY,
  round2,
  toDate,
  toDateText,
  parseDateOnlyUtc,
  countBusinessDays,
  countBusinessDaysInclusive,
  countMonthsInclusive,
  addBusinessDays,
  calculateDurationWorkDays,
  calculateEndDate,
  calculateAllocatedHours,
  calculateAllocatedHoursByDuration,
  startOfMonth,
  addMonths,
  startOfIsoWeek,
  startOfUnit,
  addUnit,
  formatUnitLabel,
  formatWeekRangeLabel,
  ordinal,
  unitGroup,
  formatMonthLabel,
  formatShortDate,
  unitsToCoverRange,
  periodBounds,
};
