const crypto = require('crypto');
const { z } = require('zod');
const { sql, getPool, isMissingAssignmentsTable } = require('../db/pool');

const STAGES = ['New', 'Discovery', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const STATUSES = ['Open', 'On Hold', 'Closed'];

const OpportunitySchema = z.object({
  name: z.string().min(1).max(200),
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
  opportunityHours: z.number().gt(0).max(100000),
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

async function listOpportunities({ q = '', sort = 'updated', dir = 'desc', stage = '', status = '' } = {}) {
  const sortColumn = sort === 'name' ? 'Name' : sort === 'created' ? 'CreatedAt' : 'UpdatedAt';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const pool = await getPool();
  const result = await pool
    .request()
    .input('q', sql.NVarChar(220), q ? `%${q}%` : null)
    .input('stage', sql.NVarChar(60), stage || null)
    .input('status', sql.NVarChar(30), status || null)
    .query(
      `SELECT TOP 500 *
       FROM dbo.Opportunities
       WHERE (@q IS NULL OR Name LIKE @q OR TechOwner LIKE @q OR BusinessOwner LIKE @q OR Tags LIKE @q)
         AND (@stage IS NULL OR Stage = @stage)
         AND (@status IS NULL OR Status = @status)
       ORDER BY ${sortColumn} ${sortDir};`
    );

  return result.recordset;
}

async function getOpportunity(rawId) {
  const id = toGuid(rawId);
  const pool = await getPool();

  const opp = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT * FROM dbo.Opportunities WHERE Id = @id;');

  if (!opp.recordset[0]) return null;

  const notes = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT * FROM dbo.OpportunityNotes WHERE OpportunityId = @id ORDER BY NoteDate DESC, CreatedAt DESC;');

  const steps = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT * FROM dbo.OpportunityNextSteps WHERE OpportunityId = @id ORDER BY IsDone ASC, DueDate ASC, CreatedAt DESC;');

  let assignments = { recordset: [] };
  try {
    assignments = await pool
      .request()
      .input('id', sql.UniqueIdentifier, id)
      .query(
        `SELECT *
         FROM dbo.OpportunityAssignments
         WHERE OpportunityId = @id
         ORDER BY IsTimelineVisible DESC, PlannedStartDate ASC, CreatedAt ASC;`
      );
  } catch (err) {
    if (!isMissingAssignmentsTable(err)) throw err;
  }

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
       (Id, Name, TechnologyStack, Description, TechOwner, BusinessOwner, FirstContactDate, Stage, Status, Priority, Tags, NextStepSummary, NextStepDueDate, OpportunityHours, OpportunityTimeline, PlannedStartDate, PlannedEndDate, AllocationPercent, CountsTowardsCapacity)
     VALUES
       (@Id, @Name, @TechnologyStack, @Description, @TechOwner, @BusinessOwner, @FirstContactDate, @Stage, @Status, @Priority, @Tags, @NextStepSummary, @NextStepDueDate, @OpportunityHours, @OpportunityTimeline, @PlannedStartDate, @PlannedEndDate, @AllocationPercent, @CountsTowardsCapacity);`
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
         CountsTowardsCapacity=@CountsTowardsCapacity
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
      `UPDATE dbo.Opportunities SET CountsTowardsCapacity=@CountsTowardsCapacity WHERE Id=@Id;
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

module.exports = {
  STAGES,
  STATUSES,
  OpportunitySchema,
  toGuid,
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  setBookingFlag,
  deleteOpportunity,
  addNote,
  deleteNote,
  addStep,
  setStepDone,
  deleteStep,
};
