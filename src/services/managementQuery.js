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
 * How far the window is shifted from the current period, in whole units.
 * Negative looks back at a period that has already happened; 0 starts today.
 */
function normalizeOffset(value, fallback) {
  const parsed = num(value);
  const offset = parsed === null ? num(fallback) || 0 : parsed;
  return Math.min(0, Math.max(-24, Math.trunc(offset)));
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
  normalizePerspective,
  normalizeUnits,
  normalizeOffset,
  resolvePeopleSelection,
};
