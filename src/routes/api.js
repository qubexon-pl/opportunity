const express = require('express');
const { getPool } = require('../db/pool');
const { listOpportunities } = require('../services/opportunityService');
const { listAssignments, addAssignment, updateAssignment, deleteAssignment } = require('../services/assignmentService');
const { listPeople, getPersonDailyHours } = require('../services/peopleService');

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
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.get('/people', (_req, res) => {
  res.json(listPeople().map((person) => ({ name: person, dailyHours: getPersonDailyHours(person) })));
});

router.get('/opportunities', async (req, res) => {
  try {
    res.json(await listOpportunities(req.query));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/assignments', async (req, res) => {
  try {
    const includeHidden = String(req.query.includeHidden || 'true').toLowerCase() === 'true';
    res.json(await listAssignments({ includeHidden }));
  } catch (err) {
    res.status(500).json({ error: String(err) });
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

module.exports = router;
