const express = require('express');
const { getPool, isDatabaseUnavailable } = require('../db/pool');
const { listOpportunities } = require('../services/opportunityService');
const { listAssignments, addAssignment, updateAssignment, deleteAssignment } = require('../services/assignmentService');
const { listPeople, getPersonDailyHours } = require('../services/peopleService');
const { addAbsence, updateAbsence, removeAbsence } = require('../services/absenceService');

const router = express.Router();

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

router.get('/health', async (_req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 as ok');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database unavailable.' });
  }
});

router.get('/people', (_req, res) => {
  res.json(listPeople().map((person) => ({ name: person, dailyHours: getPersonDailyHours(person) })));
});

router.get('/opportunities', async (req, res, next) => {
  try {
    res.json(await listOpportunities(req.query));
  } catch (err) {
    next(err);
  }
});

/**
 * Jump-to search behind the Ctrl+K palette: opportunities by name, owner, tag
 * or OPP ID, and configured people by name. Small and fast on purpose.
 */
router.get('/search', async (req, res, next) => {
  const q = String(req.query.q || '').trim();
  const needle = q.toLowerCase();
  const people = listPeople()
    .filter((name) => !needle || name.toLowerCase().includes(needle))
    .slice(0, 5)
    .map((name) => ({ type: 'person', label: name, url: `/management/people/${encodeURIComponent(name)}` }));
  try {
    const rows = await listOpportunities({ q, sort: 'updated', dir: 'desc', limit: 8 });
    const opportunities = rows.map((o) => ({
      type: 'opportunity',
      label: o.Name,
      detail: [o.OppId, o.Stage, o.TechOwner].filter(Boolean).join(' · '),
      url: `/opportunities/${o.Id}`,
    }));
    res.json({ results: [...opportunities, ...people] });
  } catch (err) {
    if (isDatabaseUnavailable(err)) return res.json({ results: people, warning: 'Opportunities are unavailable right now.' });
    next(err);
  }
});

router.get('/assignments', async (req, res, next) => {
  try {
    const includeHidden = String(req.query.includeHidden || 'true').toLowerCase() === 'true';
    res.json(await listAssignments({ includeHidden }));
  } catch (err) {
    next(err);
  }
});

router.post('/opportunities/:id/assignments', async (req, res) => {
  try {
    const created = await addAssignment(req.params.id, {
      personName: String(req.body.personName || '').trim(),
      plannedStartDate: String(req.body.plannedStartDate || '').slice(0, 10),
      plannedEndDate: String(req.body.plannedEndDate || '').slice(0, 10),
      allocationPercent: num(req.body.allocationPercent),
      allocatedHours: num(req.body.allocatedHours),
      isTimelineVisible: req.body.isTimelineVisible !== false,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.patch('/assignments/:assignmentId', async (req, res) => {
  try {
    const patch = {};
    if (req.body.personName !== undefined) patch.personName = String(req.body.personName).trim();
    if (req.body.plannedStartDate !== undefined) patch.plannedStartDate = String(req.body.plannedStartDate).slice(0, 10);
    if (req.body.plannedEndDate !== undefined) patch.plannedEndDate = String(req.body.plannedEndDate).slice(0, 10);
    if (req.body.allocationPercent !== undefined) patch.allocationPercent = num(req.body.allocationPercent);
    if (req.body.allocatedHours !== undefined) patch.allocatedHours = num(req.body.allocatedHours);
    if (req.body.isTimelineVisible !== undefined) patch.isTimelineVisible = !!req.body.isTimelineVisible;

    const load = await updateAssignment(req.params.assignmentId, patch);
    res.json({ ok: true, ...load });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.delete('/assignments/:assignmentId', async (req, res) => {
  try {
    const deleted = await deleteAssignment(req.params.assignmentId);
    if (!deleted) return res.status(404).json({ error: 'Assignment not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.post('/people/:person/absences', async (req, res) => {
  try {
    const person = decodeURIComponent(req.params.person);
    const created = await addAbsence(person, {
      startDate: String(req.body.startDate || '').slice(0, 10),
      endDate: String(req.body.endDate || '').slice(0, 10),
      kind: req.body.kind,
      note: req.body.note,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.patch('/people/:person/absences/:absenceId', async (req, res) => {
  try {
    const person = decodeURIComponent(req.params.person);
    const updated = await updateAbsence(person, req.params.absenceId, {
      startDate: String(req.body.startDate || '').slice(0, 10),
      endDate: String(req.body.endDate || '').slice(0, 10),
      kind: req.body.kind,
      note: req.body.note,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.delete('/people/:person/absences/:absenceId', async (req, res) => {
  try {
    const person = decodeURIComponent(req.params.person);
    await removeAbsence(person, req.params.absenceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

module.exports = router;
