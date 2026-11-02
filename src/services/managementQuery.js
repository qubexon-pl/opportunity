/**
 * Reading the management period and filters out of a request.
 *
 * The Team capacity page is not the only thing that answers questions about a
 * period any more - the top bar reports on the same window - so the rules for
 * turning query parameters into a window live here rather than inside the
 * route. Two readers of the same query must land on the same numbers.
 */

const { TIMELINE_UNIT_OPTIONS } = require('./capacityService');
const { filterAgainst } = require('./filterService');

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
 * Which way the window looks from today, in whole timeline units:
 *
 *   back    - the units immediately before this one (1 month back, in
 *             November, is October)
 *   current - this unit on its own, whatever the horizon says
 *   next    - this unit and the ones after it (2 months, in November, is
 *             November and December)
 */
const PERIOD_DIRECTIONS = ['back', 'current', 'next'];

function normalizeDirection(value, fallback) {
  const key = String(value || '').trim();
  if (PERIOD_DIRECTIONS.includes(key)) return key;
  return PERIOD_DIRECTIONS.includes(fallback) ? fallback : 'next';
}

/**
 * Turns the direction and the requested horizon into the window the capacity
 * service actually measures.
 *
 * "Current" deliberately ignores the horizon - it means this month, not this
 * month and the next five - but the requested horizon is handed back untouched
 * so the form can keep showing what the reader typed.
 */
function resolveWindow(direction, unitsToShow) {
  if (direction === 'back') return { offsetUnits: -unitsToShow, effectiveUnits: unitsToShow };
  if (direction === 'current') return { offsetUnits: 0, effectiveUnits: 1 };
  return { offsetUnits: 0, effectiveUnits: unitsToShow };
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

module.exports = {
  PERIOD_DIRECTIONS,
  normalizePerspective,
  normalizeUnits,
  normalizeDirection,
  resolveWindow,
  resolvePeopleSelection,
};
