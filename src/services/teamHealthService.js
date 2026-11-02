/**
 * The one-line verdict on the team shown in the top bar.
 *
 * It answers the same question the Team capacity page does - how much of the
 * available capacity is actually chargeable over the selected period - but it
 * has to be available on every page, so it is served as a small JSON endpoint
 * and fetched in the background rather than computed during every render.
 *
 * The figure is the capacity-weighted chargeability already used by the people
 * summary, so the pill and the page can never disagree.
 */

const { listOpportunities, STATUSES, STAGES } = require('./opportunityService');
const { listAssignments } = require('./assignmentService');
const { listPeople, getManagerMap } = require('./peopleService');
const { buildManagementView } = require('./capacityService');
const { queryList, filterAgainst } = require('./filterService');
const { normalizePerspective, normalizeUnits, normalizeDirection, resolveWindow, resolvePeopleSelection } = require('./managementQuery');
const { getViewDefaults } = require('../config/settings');

const TIMELINE_FILTER_OPTIONS = [...STAGES, 'free'];

/*
 * Reading down: at or above 75% the team is where it should be, 60-74% is
 * worth watching, and below 60% is a problem. The boundaries are inclusive of
 * the lower number, so 75 is good and 59 is not merely "watch".
 */
const HEALTH_BANDS = [
  { min: 75, tone: 'good', headline: 'Team is in good shape' },
  { min: 60, tone: 'warn', headline: 'Team is below target' },
  { min: -Infinity, tone: 'bad', headline: 'Team is well below target' },
];

/* Recomputing on every page load would mean a second full capacity build per
   request. The number moves slowly, so a short shared cache is enough. */
const CACHE_TTL_MS = 20000;
let cached = null;

function bandFor(percent) {
  return HEALTH_BANDS.find((band) => percent >= band.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

/** Turns a management-page query into the arguments the capacity build needs. */
function resolveQuery(query, userId) {
  const defaults = getViewDefaults(userId).management;
  const applied = query.applied === '1';
  const unitsToShow = normalizeUnits(query.units === undefined ? defaults.units : query.units, defaults.units);
  const direction = normalizeDirection(query.period === undefined ? defaults.period : query.period, defaults.period);
  const { offsetUnits, effectiveUnits } = resolveWindow(direction, unitsToShow);

  return {
    perspective: normalizePerspective(
      query.perspective === undefined ? defaults.perspective : query.perspective,
      defaults.perspective
    ),
    unitsToShow: effectiveUnits,
    offsetUnits,
    stageFilter: applied
      ? filterAgainst(queryList(query.stage), TIMELINE_FILTER_OPTIONS)
      : filterAgainst(defaults.stages, TIMELINE_FILTER_OPTIONS),
    statusFilter: applied ? filterAgainst(queryList(query.status), STATUSES) : filterAgainst(defaults.statuses, STATUSES),
    requestedPeople: applied ? queryList(query.person) : defaults.people,
    requestedManagers: applied ? queryList(query.manager) : defaults.managers,
  };
}

async function teamHealth(query, userId) {
  const resolved = resolveQuery(query || {}, userId);
  const key = JSON.stringify([userId || '', resolved]);
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const [opportunities, assignments] = await Promise.all([
    listOpportunities({ sort: 'name', dir: 'asc' }),
    listAssignments({ includeHidden: true }),
  ]);

  const personOptions = [
    ...new Set([...listPeople(), ...assignments.map((assignment) => assignment.PersonName).filter(Boolean)]),
  ].sort((a, b) => a.localeCompare(b));
  const managersMap = getManagerMap();
  const managerOptions = [
    ...new Set(Object.values(managersMap).map((name) => String(name).trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  const selection = resolvePeopleSelection({
    requestedPeople: resolved.requestedPeople,
    requestedManagers: resolved.requestedManagers,
    personOptions,
    managerOptions,
    managersMap,
  });

  const view = buildManagementView({
    opportunities,
    assignments,
    perspective: resolved.perspective,
    unitsToShow: resolved.unitsToShow,
    offsetUnits: resolved.offsetUnits,
    stageFilter: resolved.stageFilter,
    statusFilter: resolved.statusFilter,
    personFilter: selection.people,
    personFilterActive: selection.active,
  });

  const percent = view.chargeability.real;
  const band = bandFor(percent);
  const value = {
    ok: true,
    percent,
    predicted: view.chargeability.predicted,
    tone: band.tone,
    headline: band.headline,
    // "75% chargeability" reads better than a bare number in the pill.
    summary: `${band.headline} — ${percent}% chargeability`,
    peopleCount: view.people.length,
    capacityHours: view.chargeability.capacityHours,
    activeHours: view.chargeability.activeHours,
    windowLabel: view.window.label,
    isPast: view.window.isPast,
  };

  cached = { key, at: Date.now(), value };
  return value;
}

/** Saving people, absences or assignments invalidates the figure immediately. */
function resetTeamHealthCache() {
  cached = null;
}

module.exports = { teamHealth, resetTeamHealthCache, HEALTH_BANDS };
