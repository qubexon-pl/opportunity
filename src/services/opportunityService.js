const crypto = require('crypto');
const { z } = require('zod');
const { sql, getPool, isMissingAssignmentsTable } = require('../db/pool');

const STAGES = ['New', 'Discovery', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const STATUSES = ['Open', 'On Hold', 'Closed'];

const OpportunitySchema = z.object({
  name: z.string().min(1).max(200),
  oppId: z.string().max(50).optional().nullable(),
  technologyStack: z.string().max(400).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  techOwner: z.string().max(200).optional().nullable(),
  businessOwner: z.string().max(200).optional().nullable(),
  firstContactDate: z.string().optional().nullable(),

  stage: z.string().max(60).optional().nullable(),
  status: z.string().max(30).optional().nullable(),
  priority: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.string().max(400).optional().nullable(),

  nextStepSummary: z.string().max(500).optional().nullable(),
  nextStepDueDate: z.string().optional().nullable(),
  opportunityHours: z.number().min(0).max(100000),
  opportunityTimeline: z.string().max(100).optional().nullable(),
  plannedStartDate: z.string().optional().nullable(),
  plannedEndDate: z.string().optional().nullable(),
  allocationPercent: z.number().min(1).max(100).optional().nullable(),
  countsTowardsCapacity: z.boolean().optional().nullable(),
});

const NoteSchema = z.object({
  noteDate: z.string().min(10).max(10),
  content: z.string().min(1),
});

const StepSchema = z.object({
  title: z.string().min(1).max(250),
  dueDate: z.string().optional().nullable(),
});

function toGuid(id) {
  return z.string().uuid().parse(id);
}

function bindOpportunity(request, body) {
  return request
    .input('Name', sql.NVarChar(200), body.name)
    .input('OppId', sql.NVarChar(50), body.oppId ?? null)
    .input('TechnologyStack', sql.NVarChar(400), body.technologyStack ?? null)
    .input('Description', sql.NVarChar(4000), body.description ?? null)
    .input('TechOwner', sql.NVarChar(200), body.techOwner ?? null)
    .input('BusinessOwner', sql.NVarChar(200), body.businessOwner ?? null)
    .input('FirstContactDate', sql.Date, body.firstContactDate ?? null)
    .input('Stage', sql.NVarChar(60), body.stage ?? null)
    .input('Status', sql.NVarChar(30), body.status ?? null)
    .input('Priority', sql.Int, body.priority ?? null)
    .input('Tags', sql.NVarChar(400), body.tags ?? null)
    .input('NextStepSummary', sql.NVarChar(500), body.nextStepSummary ?? null)
    .input('NextStepDueDate', sql.Date, body.nextStepDueDate ?? null)
    .input('OpportunityHours', sql.Float, body.opportunityHours)
    .input('OpportunityTimeline', sql.NVarChar(100), body.opportunityTimeline ?? null)
    .input('PlannedStartDate', sql.Date, body.plannedStartDate ?? null)
    .input('PlannedEndDate', sql.Date, body.plannedEndDate ?? null)
    .input('AllocationPercent', sql.Float, body.allocationPercent ?? null)
    .input('CountsTowardsCapacity', sql.Bit, body.countsTowardsCapacity ?? null);
}

/** Builds a parameterised IN clause, keeping user values out of the SQL text. */
function buildInClause(request, column, values, prefix, sqlType) {
  if (!values.length) return '';
  const names = values.map((value, index) => {
    const name = `${prefix}${index}`;
    request.input(name, sqlType, value);
    return `@${name}`;
  });
  return ` AND ${column} IN (${names.join(', ')})`;
}

function toFilterArray(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

/** The pipeline shows this many rows at first; more are loaded on request. */
const PAGE_SIZE = 500;

/**
 * Lists opportunities matching the filters.
 *
 * `limit` caps the rows returned (the pipeline pages through them); leave it
 * out to get every match, which is what the capacity views need. The array
 * carries `total`, the number of matches before the cap, so a capped list can
 * say how much is missing instead of silently dropping rows.
 */
async function listOpportunities({ q = '', sort = 'updated', dir = 'desc', stage = '', status = '', limit } = {}) {
  const sortColumn = sort === 'name' ? 'Name' : sort === 'created' ? 'CreatedAt' : sort === 'hours' ? 'OpportunityHours' : sort === 'stage' ? 'Stage' : sort === 'owner' ? 'TechOwner' : 'UpdatedAt';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // SQL Server rejects a column listed twice in ORDER BY, so the tie-breaker
  // must differ from the sort column.
  const tieBreaker = sortColumn === 'Name' ? 'Id ASC' : 'Name ASC';

  const stages = toFilterArray(stage);
  const statuses = toFilterArray(status);
  const cap = Number(limit);
  const top = Number.isInteger(cap) && cap > 0 ? `TOP (${Math.min(cap, 100000)}) ` : '';

  const pool = await getPool();
  const request = pool.request().input('q', sql.NVarChar(220), q ? `%${q}%` : null);

  const stageClause = buildInClause(request, 'Stage', stages, 'stage', sql.NVarChar(60));
  const statusClause = buildInClause(request, 'Status', statuses, 'status', sql.NVarChar(30));

  const result = await request.query(
    `SELECT ${top}*, COUNT(*) OVER () AS TotalCount
     FROM dbo.Opportunities
     WHERE (@q IS NULL OR Name LIKE @q OR TechOwner LIKE @q OR BusinessOwner LIKE @q OR Tags LIKE @q OR OppId LIKE @q)${stageClause}${statusClause}
     ORDER BY ${sortColumn} ${sortDir}, ${tieBreaker};`
  );

  const rows = result.recordset;
  rows.total = rows.length ? Number(rows[0].TotalCount) : 0;
  return rows;
}

async function getOpportunity(rawId) {
  const id = toGuid(rawId);
  const pool = await getPool();

  // Four independent reads: run them side by side rather than one after another,
  // so the page waits for one round trip to Azure SQL instead of four.
  const byId = () => pool.request().input('id', sql.UniqueIdentifier, id);
  const [opp, notes, steps, assignments] = await Promise.all([
    byId().query('SELECT * FROM dbo.Opportunities WHERE Id = @id;'),
    byId().query('SELECT * FROM dbo.OpportunityNotes WHERE OpportunityId = @id ORDER BY NoteDate DESC, CreatedAt DESC;'),
    byId().query('SELECT * FROM dbo.OpportunityNextSteps WHERE OpportunityId = @id ORDER BY IsDone ASC, DueDate ASC, CreatedAt DESC;'),
    byId()
      .query(
        `SELECT *
         FROM dbo.OpportunityAssignments
         WHERE OpportunityId = @id
         ORDER BY IsTimelineVisible DESC, PlannedStartDate ASC, CreatedAt ASC;`
      )
      .catch((err) => {
        if (!isMissingAssignmentsTable(err)) throw err;
        return { recordset: [] };
      }),
  ]);

  if (!opp.recordset[0]) return null;

  return {
    opportunity: opp.recordset[0],
    notes: notes.recordset,
    nextSteps: steps.recordset,
    assignments: assignments.recordset,
  };
}

async function createOpportunity(payload) {
  const body = OpportunitySchema.parse(payload);
  const newId = crypto.randomUUID();
  const pool = await getPool();

  await bindOpportunity(pool.request().input('Id', sql.UniqueIdentifier, newId), body).query(
    `INSERT INTO dbo.Opportunities
       (Id, Name, OppId, TechnologyStack, Description, TechOwner, BusinessOwner, FirstContactDate, Stage, Status, Priority, Tags, NextStepSummary, NextStepDueDate, OpportunityHours, OpportunityTimeline, PlannedStartDate, PlannedEndDate, AllocationPercent, CountsTowardsCapacity)
     VALUES
       (@Id, @Name, @OppId, @TechnologyStack, @Description, @TechOwner, @BusinessOwner, @FirstContactDate, @Stage, @Status, @Priority, @Tags, @NextStepSummary, @NextStepDueDate, @OpportunityHours, @OpportunityTimeline, @PlannedStartDate, @PlannedEndDate, @AllocationPercent, @CountsTowardsCapacity);`
  );

  return newId;
}

async function updateOpportunity(rawId, payload) {
  const id = toGuid(rawId);
  const body = OpportunitySchema.parse(payload);
  const pool = await getPool();

  const result = await bindOpportunity(pool.request().input('Id', sql.UniqueIdentifier, id), body).query(
    `UPDATE dbo.Opportunities
     SET Name=@Name,
         OppId=@OppId,
         TechnologyStack=@TechnologyStack,
         Description=@Description,
         TechOwner=@TechOwner,
         BusinessOwner=@BusinessOwner,
         FirstContactDate=@FirstContactDate,
         Stage=@Stage,
         Status=@Status,
         Priority=@Priority,
         Tags=@Tags,
         NextStepSummary=@NextStepSummary,
         NextStepDueDate=@NextStepDueDate,
         OpportunityHours=@OpportunityHours,
         OpportunityTimeline=@OpportunityTimeline,
         PlannedStartDate=@PlannedStartDate,
         PlannedEndDate=@PlannedEndDate,
         AllocationPercent=@AllocationPercent,
         CountsTowardsCapacity=@CountsTowardsCapacity,
         UpdatedAt=SYSUTCDATETIME()
     WHERE Id=@Id;
     SELECT @@ROWCOUNT as affected;`
  );

  return result.recordset[0].affected > 0;
}

/** Updates only the capacity booking override (used by the pipeline inline control). */
async function setBookingFlag(rawId, flag) {
  const id = toGuid(rawId);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, id)
    .input('CountsTowardsCapacity', sql.Bit, flag === null || flag === undefined ? null : !!flag)
    .query(
      `UPDATE dbo.Opportunities SET CountsTowardsCapacity=@CountsTowardsCapacity, UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id;
       SELECT @@ROWCOUNT as affected;`
    );
  return result.recordset[0].affected > 0;
}

const QuickUpdateSchema = z
  .object({
    stage: z.enum(STAGES).optional(),
    status: z.enum(STATUSES).optional(),
    techOwner: z.string().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

/**
 * Changes a single field from the pipeline (table cell or board drag) without
 * re-sending the whole form, so nothing else on the record can be overwritten.
 */
async function quickUpdateOpportunity(rawId, patch) {
  const id = toGuid(rawId);
  const body = QuickUpdateSchema.parse(patch);
  const pool = await getPool();
  const request = pool.request().input('Id', sql.UniqueIdentifier, id);
  const sets = [];
  if (body.stage !== undefined) {
    request.input('Stage', sql.NVarChar(60), body.stage);
    sets.push('Stage=@Stage');
  }
  if (body.status !== undefined) {
    request.input('Status', sql.NVarChar(30), body.status);
    sets.push('Status=@Status');
  }
  if (body.techOwner !== undefined) {
    request.input('TechOwner', sql.NVarChar(200), body.techOwner || null);
    sets.push('TechOwner=@TechOwner');
  }
  const result = await request.query(
    `UPDATE dbo.Opportunities SET ${sets.join(', ')}, UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id;
     SELECT @@ROWCOUNT as affected;`
  );
  return result.recordset[0].affected > 0;
}

async function deleteOpportunity(rawId) {
  const id = toGuid(rawId);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, id)
    .query('DELETE FROM dbo.Opportunities WHERE Id=@Id; SELECT @@ROWCOUNT as affected;');
  return result.recordset[0].affected > 0;
}

async function addNote(rawOpportunityId, payload) {
  const opportunityId = toGuid(rawOpportunityId);
  const body = NoteSchema.parse(payload);
  const newId = crypto.randomUUID();
  const pool = await getPool();

  await pool
    .request()
    .input('Id', sql.UniqueIdentifier, newId)
    .input('OpportunityId', sql.UniqueIdentifier, opportunityId)
    .input('NoteDate', sql.Date, body.noteDate)
    .input('Content', sql.NVarChar(sql.MAX), body.content)
    .query(
      `INSERT INTO dbo.OpportunityNotes (Id, OpportunityId, NoteDate, Content)
       VALUES (@Id, @OpportunityId, @NoteDate, @Content);`
    );

  return newId;
}

async function deleteNote(rawNoteId) {
  const noteId = toGuid(rawNoteId);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, noteId)
    .query('DELETE FROM dbo.OpportunityNotes WHERE Id=@Id; SELECT @@ROWCOUNT as affected;');
  return result.recordset[0].affected > 0;
}

async function addStep(rawOpportunityId, payload) {
  const opportunityId = toGuid(rawOpportunityId);
  const body = StepSchema.parse(payload);
  const newId = crypto.randomUUID();
  const pool = await getPool();

  await pool
    .request()
    .input('Id', sql.UniqueIdentifier, newId)
    .input('OpportunityId', sql.UniqueIdentifier, opportunityId)
    .input('Title', sql.NVarChar(250), body.title)
    .input('DueDate', sql.Date, body.dueDate || null)
    .query(
      `INSERT INTO dbo.OpportunityNextSteps (Id, OpportunityId, Title, DueDate)
       VALUES (@Id, @OpportunityId, @Title, @DueDate);`
    );

  return newId;
}

async function setStepDone(rawStepId, isDone) {
  const stepId = toGuid(rawStepId);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, stepId)
    .input('IsDone', sql.Bit, !!isDone)
    .query('UPDATE dbo.OpportunityNextSteps SET IsDone=@IsDone WHERE Id=@Id; SELECT @@ROWCOUNT as affected;');
  return result.recordset[0].affected > 0;
}

async function deleteStep(rawStepId) {
  const stepId = toGuid(rawStepId);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, stepId)
    .query('DELETE FROM dbo.OpportunityNextSteps WHERE Id=@Id; SELECT @@ROWCOUNT as affected;');
  return result.recordset[0].affected > 0;
}

/**
 * Open next steps across every opportunity, dated ones first. This drives the
 * pipeline's "Upcoming actions" card (which keeps only the dated ones) and its
 * "Next step" column (which also shows steps nobody has put a date on yet).
 */
async function listOpenNextSteps() {
  const pool = await getPool();
  const result = await pool.request().query(
    `SELECT s.Id, s.OpportunityId, s.Title, s.DueDate, o.Name as OpportunityName, o.Stage, o.Status
     FROM dbo.OpportunityNextSteps s
     INNER JOIN dbo.Opportunities o ON o.Id = s.OpportunityId
     WHERE s.IsDone = 0 AND o.Status <> 'Closed'
     ORDER BY CASE WHEN s.DueDate IS NULL THEN 1 ELSE 0 END, s.DueDate ASC, s.CreatedAt ASC;`
  );
  return result.recordset;
}

module.exports = {
  STAGES,
  STATUSES,
  PAGE_SIZE,
  OpportunitySchema,
  toGuid,
  listOpportunities,
  listOpenNextSteps,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  setBookingFlag,
  quickUpdateOpportunity,
  deleteOpportunity,
  addNote,
  deleteNote,
  addStep,
  setStepDone,
  deleteStep,
};
