const crypto = require('crypto');
const { z } = require('zod');
const { sql, getPool, isMissingAssignmentsTable, isMissingColumn } = require('../db/pool');
const { toGuid } = require('./opportunityService');
const { round2, toDateText, calculateAllocatedHours, countBusinessDaysInclusive } = require('./dateService');

const MIGRATION_HINT = 'Missing database migration: run src/sql/004_create_opportunity_assignments.sql';
const HOLD_MIGRATION_HINT = 'Missing database migration: run src/sql/006_add_assignment_hold_window.sql';
const MODE_MIGRATION_HINT = 'Missing database migration: run src/sql/007_add_assignment_allocation_mode.sql';
const INITIAL_HOURS_MIGRATION_HINT = 'Missing database migration: run src/sql/008_add_initial_allocated_hours.sql';

/** How the user expressed the allocation. Legacy rows have no mode and read back as a percentage. */
const ALLOCATION_MODES = ['percent', 'total-hours', 'monthly-hours'];
const DEFAULT_ALLOCATION_MODE = 'percent';

function normalizeAllocationMode(value) {
  const mode = String(value ?? '').trim();
  return ALLOCATION_MODES.includes(mode) ? mode : null;
}

/** Optional date: an empty string clears the value, undefined leaves it untouched. */
const OptionalDate = z.union([z.string().length(10), z.literal(''), z.null()]).optional();

const AssignmentBaseSchema = z.object({
  personName: z.string().min(1).max(200),
  plannedStartDate: z.string().min(10).max(10),
  plannedEndDate: z.string().min(10).max(10),
  allocationPercent: z.number().gt(0).max(100, 'cannot exceed 100% of the opportunity total hours').optional(),
  allocatedHours: z.number().gt(0).max(100000).optional(),
  allocationMode: z.enum(['percent', 'total-hours', 'monthly-hours']).optional(),
  isTimelineVisible: z.boolean().optional(),
  holdStartDate: OptionalDate,
  holdEndDate: OptionalDate,
});

const AssignmentCreateSchema = AssignmentBaseSchema;
const AssignmentUpdateSchema = AssignmentBaseSchema.partial();

/**
 * Resolves the pair (allocatedHours, allocationPercent) from whichever value the caller supplied.
 */
function deriveAssignmentLoad(opportunityHours, candidateAllocatedHours, candidateAllocationPercent) {
  const oppHours = Number(opportunityHours || 0);
  const hasAllocatedHours = Number.isFinite(Number(candidateAllocatedHours)) && Number(candidateAllocatedHours) > 0;
  const hasAllocationPercent = Number.isFinite(Number(candidateAllocationPercent)) && Number(candidateAllocationPercent) > 0;

  if (hasAllocatedHours && hasAllocationPercent) {
    const allocatedHours = round2(candidateAllocatedHours);
    const allocationPercent = round2(candidateAllocationPercent);
    if (allocationPercent > 100) throw new Error('Allocation percent cannot exceed 100.');
    return { allocatedHours, allocationPercent };
  }

  if (hasAllocatedHours) {
    const allocatedHours = round2(candidateAllocatedHours);
    if (oppHours <= 0) {
      throw new Error('OpportunityHours must be greater than 0 to derive allocation percent from assigned hours.');
    }
    const allocationPercent = round2((allocatedHours / oppHours) * 100);
    if (allocationPercent > 100) throw new Error('Assigned hours cannot exceed total opportunity hours.');
    return { allocatedHours, allocationPercent };
  }

  if (hasAllocationPercent) {
    const allocationPercent = round2(candidateAllocationPercent);
    return { allocationPercent, allocatedHours: calculateAllocatedHours(oppHours, allocationPercent) };
  }

  throw new Error('Provide allocationPercent or allocatedHours.');
}

/**
 * Scales hours to a new window while keeping the daily intensity the assignment
 * already had. Deriving the rate from the stored hours and the window they were
 * stored against makes repeated drags stable rather than compounding.
 */
function rescaleHoursToWindow(currentHours, fromStart, fromEnd, toStart, toEnd) {
  const previousDays = countBusinessDaysInclusive(fromStart, fromEnd);
  const nextDays = countBusinessDaysInclusive(toStart, toEnd);
  if (nextDays <= 0) return 0;
  if (previousDays <= 0) return round2(currentHours);
  return round2((Number(currentHours || 0) / previousDays) * nextDays);
}

/**
 * Normalises an optional hold window. Both ends are required together; passing
 * empty strings clears an existing hold.
 */
function normalizeHold(startValue, endValue) {
  const start = startValue ? String(startValue).slice(0, 10) : null;
  const end = endValue ? String(endValue).slice(0, 10) : null;

  if (!start && !end) return { holdStartDate: null, holdEndDate: null };
  if (!start || !end) throw new Error('A hold needs both a start and an end date.');
  if (new Date(end) < new Date(start)) throw new Error('Hold end date must be on or after the hold start date.');

  return { holdStartDate: start, holdEndDate: end };
}

/** Surfaces a clear migration hint when the hold columns are not deployed yet. */
function rethrowAssignmentError(err) {
  if (isMissingAssignmentsTable(err)) throw new Error(MIGRATION_HINT);
  if (isMissingColumn(err, 'HoldStartDate') || isMissingColumn(err, 'HoldEndDate')) throw new Error(HOLD_MIGRATION_HINT);
  if (isMissingColumn(err, 'AllocationMode')) throw new Error(MODE_MIGRATION_HINT);
  if (isMissingColumn(err, 'InitialAllocatedHours')) throw new Error(INITIAL_HOURS_MIGRATION_HINT);
  throw err;
}

async function listAssignments({ includeHidden = true } = {}) {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('includeHidden', sql.Bit, !!includeHidden)
      .query(
        `SELECT a.*, o.Name as OpportunityName, o.Stage, o.Status, o.OpportunityHours, o.CountsTowardsCapacity
         FROM dbo.OpportunityAssignments a
         INNER JOIN dbo.Opportunities o ON o.Id = a.OpportunityId
         WHERE (@includeHidden = 1 OR a.IsTimelineVisible = 1)
         ORDER BY a.PersonName ASC, a.PlannedStartDate ASC, a.CreatedAt ASC;`
      );
    return result.recordset;
  } catch (err) {
    if (isMissingAssignmentsTable(err)) return [];
    throw err;
  }
}

async function addAssignment(rawOpportunityId, payload) {
  const opportunityId = toGuid(rawOpportunityId);
  const body = AssignmentCreateSchema.parse(payload);

  if (new Date(body.plannedEndDate) < new Date(body.plannedStartDate)) {
    throw new Error('End date must be equal to or after start date.');
  }

  const pool = await getPool();
  const opp = await pool
    .request()
    .input('id', sql.UniqueIdentifier, opportunityId)
    .query('SELECT OpportunityHours FROM dbo.Opportunities WHERE Id=@id;');

  if (!opp.recordset[0]) throw new Error('Opportunity not found.');

  const opportunityHours = Number(opp.recordset[0].OpportunityHours || 0);
  const load = deriveAssignmentLoad(opportunityHours, body.allocatedHours, body.allocationPercent);
  const hold = normalizeHold(body.holdStartDate, body.holdEndDate);
  const allocationMode = normalizeAllocationMode(body.allocationMode);
  const newId = crypto.randomUUID();

  try {
    await pool
      .request()
      .input('Id', sql.UniqueIdentifier, newId)
      .input('OpportunityId', sql.UniqueIdentifier, opportunityId)
      .input('PersonName', sql.NVarChar(200), body.personName)
      .input('PlannedStartDate', sql.Date, body.plannedStartDate)
      .input('PlannedEndDate', sql.Date, body.plannedEndDate)
      .input('AllocationPercent', sql.Float, load.allocationPercent)
      .input('AllocatedHours', sql.Float, load.allocatedHours)
      .input('InitialAllocatedHours', sql.Float, load.allocatedHours)
      .input('AllocationMode', sql.NVarChar(20), allocationMode)
      .input('IsTimelineVisible', sql.Bit, body.isTimelineVisible ?? true)
      .input('HoldStartDate', sql.Date, hold.holdStartDate)
      .input('HoldEndDate', sql.Date, hold.holdEndDate)
      .query(
        `INSERT INTO dbo.OpportunityAssignments
           (Id, OpportunityId, PersonName, PlannedStartDate, PlannedEndDate, AllocationPercent, AllocatedHours, InitialAllocatedHours, AllocationMode, IsTimelineVisible, HoldStartDate, HoldEndDate)
         VALUES
           (@Id, @OpportunityId, @PersonName, @PlannedStartDate, @PlannedEndDate, @AllocationPercent, @AllocatedHours, @InitialAllocatedHours, @AllocationMode, @IsTimelineVisible, @HoldStartDate, @HoldEndDate);`
      );
  } catch (err) {
    rethrowAssignmentError(err);
  }

  return { id: newId, allocationMode, initialAllocatedHours: load.allocatedHours, ...load, ...hold };
}

async function updateAssignment(rawAssignmentId, payload) {
  const assignmentId = toGuid(rawAssignmentId);
  const body = AssignmentUpdateSchema.parse(payload);
  const pool = await getPool();

  let current;
  try {
    current = await pool
      .request()
      .input('id', sql.UniqueIdentifier, assignmentId)
      .query(
        `SELECT a.*, o.OpportunityHours
         FROM dbo.OpportunityAssignments a
         INNER JOIN dbo.Opportunities o ON o.Id = a.OpportunityId
         WHERE a.Id=@id;`
      );
  } catch (err) {
    if (isMissingAssignmentsTable(err)) throw new Error(MIGRATION_HINT);
    throw err;
  }

  const row = current.recordset[0];
  if (!row) throw new Error('Assignment not found.');

  const currentStartDate = toDateText(row.PlannedStartDate);
  const currentEndDate = toDateText(row.PlannedEndDate);

  const next = {
    personName: body.personName ?? row.PersonName,
    plannedStartDate: body.plannedStartDate ?? currentStartDate,
    plannedEndDate: body.plannedEndDate ?? currentEndDate,
    allocationPercent: body.allocationPercent,
    allocatedHours: body.allocatedHours,
    isTimelineVisible: body.isTimelineVisible ?? !!row.IsTimelineVisible,
  };

  // An omitted mode keeps whatever the assignment was created with.
  const allocationMode = body.allocationMode === undefined
    ? normalizeAllocationMode(row.AllocationMode)
    : normalizeAllocationMode(body.allocationMode);

  // An omitted hold field keeps the stored window; an empty string clears it.
  const hold = normalizeHold(
    body.holdStartDate === undefined ? toDateText(row.HoldStartDate) : body.holdStartDate,
    body.holdEndDate === undefined ? toDateText(row.HoldEndDate) : body.holdEndDate
  );

  if (new Date(next.plannedEndDate) < new Date(next.plannedStartDate)) {
    throw new Error('End date must be equal to or after start date.');
  }

  const datesChanged = next.plannedStartDate !== currentStartDate || next.plannedEndDate !== currentEndDate;

  // The hours the assignment was defined with. Legacy rows fall back to their
  // share of the opportunity total, then to whatever was last stored.
  const storedInitial = Number(row.InitialAllocatedHours);
  const initialFromPercent = round2(
    Number(row.OpportunityHours || 0) * (Number(row.AllocationPercent || 0) / 100)
  );
  const previousInitial = Number.isFinite(storedInitial) && storedInitial > 0
    ? round2(storedInitial)
    : initialFromPercent > 0
      ? initialFromPercent
      : round2(Number(row.AllocatedHours || 0));

  let load;
  let initialAllocatedHours;
  if (next.allocatedHours !== undefined && next.allocationPercent !== undefined) {
    load = deriveAssignmentLoad(row.OpportunityHours, next.allocatedHours, next.allocationPercent);
    initialAllocatedHours = load.allocatedHours;
  } else if (next.allocatedHours !== undefined) {
    load = deriveAssignmentLoad(row.OpportunityHours, next.allocatedHours, undefined);
    initialAllocatedHours = load.allocatedHours;
  } else if (datesChanged) {
    // Broadening or squeezing the bar keeps the daily intensity the assignment
    // already had and scales the real hours with the new window. The percentage
    // and the initial figure describe how the work was agreed, so they stay put.
    load = {
      allocationPercent: round2(Number(row.AllocationPercent || 0)),
      allocatedHours: rescaleHoursToWindow(
        Number(row.AllocatedHours || 0),
        currentStartDate,
        currentEndDate,
        next.plannedStartDate,
        next.plannedEndDate
      ),
    };
    initialAllocatedHours = previousInitial;
  } else {
    load = deriveAssignmentLoad(row.OpportunityHours, undefined, next.allocationPercent ?? row.AllocationPercent);
    initialAllocatedHours = next.allocationPercent !== undefined ? load.allocatedHours : previousInitial;
  }

  const result = await pool
    .request()
    .input('Id', sql.UniqueIdentifier, assignmentId)
    .input('PersonName', sql.NVarChar(200), next.personName)
    .input('PlannedStartDate', sql.Date, next.plannedStartDate)
    .input('PlannedEndDate', sql.Date, next.plannedEndDate)
    .input('AllocationPercent', sql.Float, load.allocationPercent)
    .input('AllocatedHours', sql.Float, load.allocatedHours)
    .input('InitialAllocatedHours', sql.Float, initialAllocatedHours)
    .input('AllocationMode', sql.NVarChar(20), allocationMode)
    .input('IsTimelineVisible', sql.Bit, next.isTimelineVisible)
    .input('HoldStartDate', sql.Date, hold.holdStartDate)
    .input('HoldEndDate', sql.Date, hold.holdEndDate)
    .query(
      `UPDATE dbo.OpportunityAssignments
       SET PersonName=@PersonName,
           PlannedStartDate=@PlannedStartDate,
           PlannedEndDate=@PlannedEndDate,
           AllocationPercent=@AllocationPercent,
           AllocatedHours=@AllocatedHours,
           InitialAllocatedHours=@InitialAllocatedHours,
           AllocationMode=@AllocationMode,
           IsTimelineVisible=@IsTimelineVisible,
           HoldStartDate=@HoldStartDate,
           HoldEndDate=@HoldEndDate,
           UpdatedAt=SYSUTCDATETIME()
       WHERE Id=@Id;
       SELECT @@ROWCOUNT as affected;`
    )
    .catch(rethrowAssignmentError);

  if (result.recordset[0].affected === 0) throw new Error('Assignment not found.');
  return { allocationMode, initialAllocatedHours, ...load, ...hold };
}

async function deleteAssignment(rawAssignmentId) {
  const assignmentId = toGuid(rawAssignmentId);
  const pool = await getPool();

  try {
    const result = await pool
      .request()
      .input('Id', sql.UniqueIdentifier, assignmentId)
      .query('DELETE FROM dbo.OpportunityAssignments WHERE Id=@Id; SELECT @@ROWCOUNT as affected;');
    return result.recordset[0].affected > 0;
  } catch (err) {
    if (isMissingAssignmentsTable(err)) throw new Error(MIGRATION_HINT);
    throw err;
  }
}

module.exports = {
  ALLOCATION_MODES,
  DEFAULT_ALLOCATION_MODE,
  AssignmentCreateSchema,
  AssignmentUpdateSchema,
  deriveAssignmentLoad,
  rescaleHoursToWindow,
  normalizeAllocationMode,
  normalizeHold,
  listAssignments,
  addAssignment,
  updateAssignment,
  deleteAssignment,
};
