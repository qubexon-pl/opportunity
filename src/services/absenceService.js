const { getConfig, updatePeopleConfig } = require('../config/settings');
const { parseDateOnlyUtc, toDateText, countBusinessDaysInclusive } = require('./dateService');

/**
 * Absence is time a person is simply not available: it removes working days from
 * their capacity for the period it covers.
 *
 * It is deliberately *not* the same thing as an allocation hold. A hold pauses
 * one piece of work and hands its hours back to the person, so their free
 * capacity grows. An absence shrinks the capacity itself, so free capacity
 * falls. Neither changes what an assignment has agreed to deliver.
 */
const ABSENCE_KINDS = ['Vacation', 'Public holiday', 'Sick leave', 'Parental leave', 'Training', 'Other'];

const DEFAULT_ABSENCE_KIND = 'Vacation';

function absenceMap() {
  const configured = getConfig().people.absences || {};
  const map = {};
  Object.keys(configured).forEach((person) => {
    map[person] = Array.isArray(configured[person]) ? configured[person].map(normalizeStored).filter(Boolean) : [];
  });
  return map;
}

/** Tolerates hand-edited config: anything without a usable range is dropped. */
function normalizeStored(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const startDate = String(entry.startDate || '').slice(0, 10);
  const endDate = String(entry.endDate || '').slice(0, 10);
  if (!parseDateOnlyUtc(startDate) || !parseDateOnlyUtc(endDate)) return null;
  if (endDate < startDate) return null;

  const kind = ABSENCE_KINDS.includes(entry.kind) ? entry.kind : DEFAULT_ABSENCE_KIND;
  return {
    id: String(entry.id || `${startDate}_${endDate}_${kind}`),
    startDate,
    endDate,
    kind,
    note: String(entry.note || ''),
    businessDays: countBusinessDaysInclusive(startDate, endDate),
  };
}

function byStart(a, b) {
  return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
}

function listAbsences(personName) {
  return (absenceMap()[String(personName || '')] || []).slice().sort(byStart);
}

function listAllAbsences() {
  const map = absenceMap();
  Object.keys(map).forEach((person) => map[person].sort(byStart));
  return map;
}

function normalizeInput({ startDate, endDate, kind, note }) {
  const start = String(startDate || '').slice(0, 10);
  const end = String(endDate || '').slice(0, 10);
  if (!parseDateOnlyUtc(start)) throw new Error('Absence start date is required.');
  if (!parseDateOnlyUtc(end)) throw new Error('Absence end date is required.');
  if (end < start) throw new Error('Absence end date must not be before the start date.');

  const value = String(kind || DEFAULT_ABSENCE_KIND).trim();
  if (!ABSENCE_KINDS.includes(value)) throw new Error(`Unknown absence type: ${value}`);

  if (countBusinessDaysInclusive(start, end) === 0) {
    throw new Error('That range covers no working days, so it would not change capacity.');
  }

  return { startDate: start, endDate: end, kind: value, note: String(note || '').trim().slice(0, 200) };
}

function addAbsence(personName, input) {
  const person = String(personName || '').trim();
  if (!person) throw new Error('Person name is required.');

  const absence = normalizeInput(input || {});
  const map = absenceMap();
  const existing = map[person] || [];

  const duplicate = existing.some(
    (entry) => entry.startDate === absence.startDate && entry.endDate === absence.endDate && entry.kind === absence.kind
  );
  if (duplicate) throw new Error('That absence is already recorded.');

  map[person] = existing.concat({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ...absence,
  });

  updatePeopleConfig({ personAbsences: toStored(map) });
  return absence;
}

function removeAbsence(personName, absenceId) {
  const person = String(personName || '').trim();
  const id = String(absenceId || '');
  if (!person || !id) throw new Error('Person and absence are required.');

  const map = absenceMap();
  const existing = map[person] || [];
  const remaining = existing.filter((entry) => entry.id !== id);
  if (remaining.length === existing.length) throw new Error('That absence no longer exists.');

  map[person] = remaining;
  updatePeopleConfig({ personAbsences: toStored(map) });
}

/**
 * Working days lost to absence in [from, toExclusive).
 *
 * Counted by walking the days rather than summing each range, so two absences
 * that overlap - a public holiday inside a vacation, say - still cost one day.
 */
function absenceBusinessDays(personName, from, toExclusive) {
  const ranges = listAbsences(personName);
  if (!ranges.length || !from || !toExclusive || toExclusive <= from) return 0;

  let days = 0;
  const cursor = new Date(from);
  while (cursor < toExclusive) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const text = toDateText(cursor);
      if (ranges.some((range) => text >= range.startDate && text <= range.endDate)) days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** The absences a period actually touches, with the days each one costs in it. */
function absencesInWindow(personName, from, toExclusive) {
  if (!from || !toExclusive || toExclusive <= from) return [];
  const startText = toDateText(from);
  const endText = toDateText(new Date(toExclusive.getTime() - 1));

  return listAbsences(personName)
    .filter((absence) => absence.startDate <= endText && absence.endDate >= startText)
    .map((absence) => ({
      ...absence,
      daysInWindow: absenceBusinessDaysFor(absence, from, toExclusive),
    }))
    .filter((absence) => absence.daysInWindow > 0);
}

function absenceBusinessDaysFor(absence, from, toExclusive) {
  let days = 0;
  const cursor = new Date(from);
  while (cursor < toExclusive) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const text = toDateText(cursor);
      if (text >= absence.startDate && text <= absence.endDate) days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function removeAllForPerson(personName) {
  const map = absenceMap();
  delete map[String(personName || '').trim()];
  updatePeopleConfig({ personAbsences: toStored(map) });
}

/** Strips derived fields so the config file only ever holds what was entered. */
function toStored(map) {
  const stored = {};
  Object.keys(map).forEach((person) => {
    stored[person] = map[person].map(({ id, startDate, endDate, kind, note }) => ({
      id,
      startDate,
      endDate,
      kind,
      note,
    }));
  });
  return stored;
}

module.exports = {
  ABSENCE_KINDS,
  DEFAULT_ABSENCE_KIND,
  listAbsences,
  listAllAbsences,
  addAbsence,
  removeAbsence,
  removeAllForPerson,
  absenceBusinessDays,
  absencesInWindow,
};
