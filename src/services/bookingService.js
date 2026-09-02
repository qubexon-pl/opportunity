const { getConfig } = require('../config/settings');

/**
 * Booking mode chosen per opportunity.
 *  - auto:   inherit the configured stage rule
 *  - firm:   always consume committed capacity
 *  - soft:   never consume committed capacity (soft booking only)
 */
const BOOKING_MODES = [
  { key: 'auto', label: 'Follow stage rule' },
  { key: 'firm', label: 'Always count' },
  { key: 'soft', label: 'Never count (soft)' },
];

function listFirmStages() {
  return getConfig().capacity.firmStages;
}

function isFirmStage(stage, firmStages) {
  const stages = firmStages || listFirmStages();
  const normalized = String(stage || '').toLowerCase();
  return stages.some((item) => String(item).toLowerCase() === normalized);
}

/** Reads the stored override as one of the BOOKING_MODES keys. */
function bookingMode(opportunity) {
  const raw = opportunity ? opportunity.CountsTowardsCapacity : null;
  if (raw === null || raw === undefined) return 'auto';
  return raw ? 'firm' : 'soft';
}

/** Converts a form value back to the nullable BIT stored in the database. */
function bookingModeToFlag(mode) {
  if (mode === 'firm') return true;
  if (mode === 'soft') return false;
  return null;
}

/**
 * True when the opportunity's assignments consume a person's committed capacity.
 * An explicit override always wins over the stage rule.
 */
function countsTowardsCapacity(opportunity, firmStages) {
  const mode = bookingMode(opportunity);
  if (mode === 'firm') return true;
  if (mode === 'soft') return false;
  return isFirmStage(opportunity && opportunity.Stage, firmStages);
}

/** Human-readable explanation shown next to the control in the UI. */
function bookingLabel(opportunity, firmStages) {
  const mode = bookingMode(opportunity);
  const firm = countsTowardsCapacity(opportunity, firmStages);

  if (mode === 'auto') {
    return firm ? `Committed (stage ${opportunity.Stage})` : `Soft booking (stage ${opportunity.Stage || 'unspecified'})`;
  }
  return firm ? 'Committed (forced)' : 'Soft booking (forced)';
}

module.exports = {
  BOOKING_MODES,
  listFirmStages,
  isFirmStage,
  bookingMode,
  bookingModeToFlag,
  countsTowardsCapacity,
  bookingLabel,
};
