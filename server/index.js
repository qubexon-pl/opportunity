require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { z } = require("zod");
const { sql, getPool } = require("./db");

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

app.get("/health", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 as ok");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const OpportunitySchema = z.object({
  name: z.string().min(1).max(200),
  technologyStack: z.string().max(400).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  techOwner: z.string().max(200).optional().nullable(),
  businessOwner: z.string().max(200).optional().nullable(),
  firstContactDate: z.string().optional().nullable(), // YYYY-MM-DD

  stage: z.string().max(60).optional().nullable(),
  status: z.string().max(30).optional().nullable(),
  priority: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.string().max(400).optional().nullable(),

  nextStepSummary: z.string().max(500).optional().nullable(),
  nextStepDueDate: z.string().optional().nullable(), // YYYY-MM-DD
  opportunityHours: z.number().gt(0).max(100000),
  opportunityTimeline: z.string().max(100).optional().nullable(),
  plannedStartDate: z.string().optional().nullable(), // YYYY-MM-DD
  plannedEndDate: z.string().optional().nullable(), // YYYY-MM-DD
  allocationPercent: z.number().min(1).max(100).optional().nullable(),
});

function toGuid(id) {
  // Validate it’s a GUID
  return z.string().uuid().parse(id);
}

const AssignmentBaseSchema = z.object({
  personName: z.string().min(1).max(200),
  plannedStartDate: z.string().min(10).max(10), // YYYY-MM-DD
  plannedEndDate: z.string().min(10).max(10), // YYYY-MM-DD
  allocationPercent: z.number().gt(0).max(100).optional(),
  allocatedHours: z.number().gt(0).max(100000).optional(),
  isTimelineVisible: z.boolean().optional(),
});

const AssignmentCreateSchema = AssignmentBaseSchema;
const AssignmentUpdateSchema = AssignmentBaseSchema.partial();

const WORK_HOURS_PER_DAY = 8;

function parseDateOnlyUtc(value) {
  if (!value || typeof value !== "string") return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function countBusinessDaysInclusive(startDateText, endDateText) {
  const start = parseDateOnlyUtc(startDateText);
  const end = parseDateOnlyUtc(endDateText);
  if (!start || !end || end < start) return 0;

  let businessDays = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return businessDays;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateAllocatedHours(opportunityHours, allocationPercent) {
  return round2(Number(opportunityHours || 0) * (Number(allocationPercent || 0) / 100));
}

function calculateAllocatedHoursByDuration(plannedStartDate, plannedEndDate, allocationPercent) {
  const businessDays = countBusinessDaysInclusive(plannedStartDate, plannedEndDate);
  const pct = Number(allocationPercent || 0);
  if (businessDays <= 0 || pct <= 0) return 0;
  return round2(businessDays * WORK_HOURS_PER_DAY * (pct / 100));
}

function deriveAssignmentLoad(opportunityHours, candidateAllocatedHours, candidateAllocationPercent) {
  const oppHours = Number(opportunityHours || 0);
  const hasAllocatedHours = Number.isFinite(Number(candidateAllocatedHours)) && Number(candidateAllocatedHours) > 0;
  const hasAllocationPercent = Number.isFinite(Number(candidateAllocationPercent)) && Number(candidateAllocationPercent) > 0;

  if (hasAllocatedHours && hasAllocationPercent) {
    const allocatedHours = round2(candidateAllocatedHours);
    const allocationPercent = round2(candidateAllocationPercent);
    if (allocationPercent > 100) {
      throw new Error("Allocation percent cannot exceed 100.");
    }
    return { allocatedHours, allocationPercent };
  }

  if (hasAllocatedHours) {
    const allocatedHours = round2(candidateAllocatedHours);
    if (oppHours <= 0) {
      throw new Error("OpportunityHours must be greater than 0 to derive allocation percent from assigned hours.");
    }
    const allocationPercent = round2((allocatedHours / oppHours) * 100);
    if (allocationPercent > 100) {
      throw new Error("Assigned hours cannot exceed total opportunity hours.");
    }
    return { allocatedHours, allocationPercent };
  }

  if (hasAllocationPercent) {
    const allocationPercent = round2(candidateAllocationPercent);
    return {
      allocationPercent,
      allocatedHours: calculateAllocatedHours(oppHours, allocationPercent),
    };
  }

  throw new Error("Provide allocationPercent or allocatedHours.");
}

// List opportunities (simple search/sort)
app.get("/opportunities", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const sort = (req.query.sort || "updated").toString(); // updated|created|name
  const dir = (req.query.dir || "desc").toString().toLowerCase() === "asc" ? "ASC" : "DESC";
  const stage = (req.query.stage || "").toString().trim();
  const status = (req.query.status || "").toString().trim();

  const sortColumn =
    sort === "name" ? "Name" : sort === "created" ? "CreatedAt" : "UpdatedAt";

  try {
    const pool = await getPool();
    const r = await pool
      .request()
      .input("q", sql.NVarChar(220), q ? `%${q}%` : null)
      .input("stage", sql.NVarChar(60), stage || null)
      .input("status", sql.NVarChar(30), status || null)
      .query(
        `
        SELECT TOP 500 *
        FROM dbo.Opportunities
        WHERE (@q IS NULL OR Name LIKE @q OR TechOwner LIKE @q OR BusinessOwner LIKE @q OR Tags LIKE @q)
          AND (@stage IS NULL OR Stage = @stage)
          AND (@status IS NULL OR Status = @status)
        ORDER BY ${sortColumn} ${dir};
        `
      );
    res.json(r.recordset);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Get single opportunity with notes + next steps
app.get("/opportunities/:id", async (req, res) => {
  try {
    const id = toGuid(req.params.id);
    const pool = await getPool();

    const opp = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.Opportunities WHERE Id = @id;");

    if (!opp.recordset[0]) return res.status(404).json({ error: "Not found" });

    const notes = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.OpportunityNotes WHERE OpportunityId = @id ORDER BY NoteDate DESC, CreatedAt DESC;");

    const steps = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT * FROM dbo.OpportunityNextSteps WHERE OpportunityId = @id ORDER BY IsDone ASC, DueDate ASC, CreatedAt DESC;");

    let assignments = { recordset: [] };
    try {
      assignments = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query(
          `SELECT *
           FROM dbo.OpportunityAssignments
           WHERE OpportunityId = @id
           ORDER BY IsTimelineVisible DESC, PlannedStartDate ASC, CreatedAt ASC;`
        );
    } catch (e) {
      if (!String(e).includes("Invalid object name 'dbo.OpportunityAssignments'")) {
        throw e;
      }
    }

    res.json({
      opportunity: opp.recordset[0],
      notes: notes.recordset,
      nextSteps: steps.recordset,
      assignments: assignments.recordset,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Create opportunity
app.post("/opportunities", async (req, res) => {
  try {
    const body = OpportunitySchema.parse(req.body);
    const id = sql.UniqueIdentifier; // just to reference type
    const newId = require("crypto").randomUUID();

    const pool = await getPool();
    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, newId)
      .input("Name", sql.NVarChar(200), body.name)
      .input("TechnologyStack", sql.NVarChar(400), body.technologyStack ?? null)
      .input("Description", sql.NVarChar(4000), body.description ?? null)
      .input("TechOwner", sql.NVarChar(200), body.techOwner ?? null)
      .input("BusinessOwner", sql.NVarChar(200), body.businessOwner ?? null)
      .input("FirstContactDate", sql.Date, body.firstContactDate ?? null)
      .input("Stage", sql.NVarChar(60), body.stage ?? null)
      .input("Status", sql.NVarChar(30), body.status ?? null)
      .input("Priority", sql.Int, body.priority ?? null)
      .input("Tags", sql.NVarChar(400), body.tags ?? null)
      .input("NextStepSummary", sql.NVarChar(500), body.nextStepSummary ?? null)
      .input("NextStepDueDate", sql.Date, body.nextStepDueDate ?? null)
      .input("OpportunityHours", sql.Float, body.opportunityHours)
      .input("OpportunityTimeline", sql.NVarChar(100), body.opportunityTimeline ?? null)
      .input("PlannedStartDate", sql.Date, body.plannedStartDate ?? null)
      .input("PlannedEndDate", sql.Date, body.plannedEndDate ?? null)
      .input("AllocationPercent", sql.Float, body.allocationPercent ?? null)
      .query(
        `
        INSERT INTO dbo.Opportunities
          (Id, Name, TechnologyStack, Description, TechOwner, BusinessOwner, FirstContactDate, Stage, Status, Priority, Tags, NextStepSummary, NextStepDueDate, OpportunityHours, OpportunityTimeline, PlannedStartDate, PlannedEndDate, AllocationPercent)
        VALUES
          (@Id, @Name, @TechnologyStack, @Description, @TechOwner, @BusinessOwner, @FirstContactDate, @Stage, @Status, @Priority, @Tags, @NextStepSummary, @NextStepDueDate, @OpportunityHours, @OpportunityTimeline, @PlannedStartDate, @PlannedEndDate, @AllocationPercent);
        `
      );

    res.status(201).json({ id: newId });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Update opportunity
app.put("/opportunities/:id", async (req, res) => {
  try {
    const id = toGuid(req.params.id);
    const body = OpportunitySchema.parse(req.body);

    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, id)
      .input("Name", sql.NVarChar(200), body.name)
      .input("TechnologyStack", sql.NVarChar(400), body.technologyStack ?? null)
      .input("Description", sql.NVarChar(4000), body.description ?? null)
      .input("TechOwner", sql.NVarChar(200), body.techOwner ?? null)
      .input("BusinessOwner", sql.NVarChar(200), body.businessOwner ?? null)
      .input("FirstContactDate", sql.Date, body.firstContactDate ?? null)
      .input("Stage", sql.NVarChar(60), body.stage ?? null)
      .input("Status", sql.NVarChar(30), body.status ?? null)
      .input("Priority", sql.Int, body.priority ?? null)
      .input("Tags", sql.NVarChar(400), body.tags ?? null)
      .input("NextStepSummary", sql.NVarChar(500), body.nextStepSummary ?? null)
      .input("NextStepDueDate", sql.Date, body.nextStepDueDate ?? null)
      .input("OpportunityHours", sql.Float, body.opportunityHours)
      .input("OpportunityTimeline", sql.NVarChar(100), body.opportunityTimeline ?? null)
      .input("PlannedStartDate", sql.Date, body.plannedStartDate ?? null)
      .input("PlannedEndDate", sql.Date, body.plannedEndDate ?? null)
      .input("AllocationPercent", sql.Float, body.allocationPercent ?? null)
      .query(
        `
        UPDATE dbo.Opportunities
        SET
          Name=@Name,
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
          AllocationPercent=@AllocationPercent
        WHERE Id=@Id;
        SELECT @@ROWCOUNT as affected;
        `
      );

    if (result.recordset[0].affected === 0) return res.status(404).json({ error: "Not found" });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Delete opportunity (cascades notes + steps)
app.delete("/opportunities/:id", async (req, res) => {
  try {
    const id = toGuid(req.params.id);
    const pool = await getPool();
    const r = await pool.request().input("Id", sql.UniqueIdentifier, id).query("DELETE FROM dbo.Opportunities WHERE Id=@Id; SELECT @@ROWCOUNT as affected;");
    if (r.recordset[0].affected === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// List assignments across all opportunities (for management timeline)
app.get("/assignments", async (req, res) => {
  const includeHidden = String(req.query.includeHidden || "false").toLowerCase() === "true";
  try {
    const pool = await getPool();
    let r;
    try {
      r = await pool
        .request()
        .input("includeHidden", sql.Bit, includeHidden)
        .query(
          `SELECT
             a.*,
             o.Name as OpportunityName,
             o.Stage,
             o.Status,
             o.OpportunityHours
           FROM dbo.OpportunityAssignments a
           INNER JOIN dbo.Opportunities o ON o.Id = a.OpportunityId
           WHERE (@includeHidden = 1 OR a.IsTimelineVisible = 1)
           ORDER BY a.PersonName ASC, a.PlannedStartDate ASC, a.CreatedAt ASC;`
        );
    } catch (e) {
      if (String(e).includes("Invalid object name 'dbo.OpportunityAssignments'")) {
        return res.json([]);
      }
      throw e;
    }

    res.json(r.recordset);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Add assignment (supports assigning one opportunity to multiple people)
app.post("/opportunities/:id/assignments", async (req, res) => {
  try {
    const opportunityId = toGuid(req.params.id);
    const body = AssignmentCreateSchema.parse(req.body);

    if (new Date(body.plannedEndDate) < new Date(body.plannedStartDate)) {
      return res.status(400).json({ error: "plannedEndDate must be equal to or after plannedStartDate" });
    }

    const pool = await getPool();
    const opp = await pool
      .request()
      .input("id", sql.UniqueIdentifier, opportunityId)
      .query("SELECT OpportunityHours FROM dbo.Opportunities WHERE Id=@id;");

    if (!opp.recordset[0]) return res.status(404).json({ error: "Opportunity not found" });

    const opportunityHours = Number(opp.recordset[0].OpportunityHours || 0);
    const load = deriveAssignmentLoad(opportunityHours, body.allocatedHours, body.allocationPercent);
    const newId = require("crypto").randomUUID();

    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, newId)
      .input("OpportunityId", sql.UniqueIdentifier, opportunityId)
      .input("PersonName", sql.NVarChar(200), body.personName)
      .input("PlannedStartDate", sql.Date, body.plannedStartDate)
      .input("PlannedEndDate", sql.Date, body.plannedEndDate)
      .input("AllocationPercent", sql.Float, load.allocationPercent)
      .input("AllocatedHours", sql.Float, load.allocatedHours)
      .input("IsTimelineVisible", sql.Bit, body.isTimelineVisible ?? true)
      .query(
        `INSERT INTO dbo.OpportunityAssignments
          (Id, OpportunityId, PersonName, PlannedStartDate, PlannedEndDate, AllocationPercent, AllocatedHours, IsTimelineVisible)
         VALUES
          (@Id, @OpportunityId, @PersonName, @PlannedStartDate, @PlannedEndDate, @AllocationPercent, @AllocatedHours, @IsTimelineVisible);`
      );

    res.status(201).json({ id: newId, allocatedHours: load.allocatedHours, allocationPercent: load.allocationPercent });
  } catch (e) {
    if (String(e).includes("Invalid object name 'dbo.OpportunityAssignments'")) {
      return res.status(400).json({
        error: "Missing database migration: run server/sql/004_create_opportunity_assignments.sql",
      });
    }
    res.status(400).json({ error: String(e) });
  }
});

// Update assignment
app.patch("/assignments/:assignmentId", async (req, res) => {
  try {
    const assignmentId = toGuid(req.params.assignmentId);
    const body = AssignmentUpdateSchema.parse(req.body);

    const pool = await getPool();
    const current = await pool
      .request()
      .input("id", sql.UniqueIdentifier, assignmentId)
      .query(
        `SELECT a.*, o.OpportunityHours
         FROM dbo.OpportunityAssignments a
         INNER JOIN dbo.Opportunities o ON o.Id = a.OpportunityId
         WHERE a.Id=@id;`
      );

    const row = current.recordset[0];
    if (!row) return res.status(404).json({ error: "Assignment not found" });

    const next = {
      personName: body.personName ?? row.PersonName,
      plannedStartDate: body.plannedStartDate ?? row.PlannedStartDate?.toISOString().slice(0, 10),
      plannedEndDate: body.plannedEndDate ?? row.PlannedEndDate?.toISOString().slice(0, 10),
      allocationPercent: body.allocationPercent,
      allocatedHours: body.allocatedHours,
      isTimelineVisible: body.isTimelineVisible ?? !!row.IsTimelineVisible,
    };

    if (new Date(next.plannedEndDate) < new Date(next.plannedStartDate)) {
      return res.status(400).json({ error: "plannedEndDate must be equal to or after plannedStartDate" });
    }

    const currentStartDate = row.PlannedStartDate?.toISOString().slice(0, 10);
    const currentEndDate = row.PlannedEndDate?.toISOString().slice(0, 10);
    const datesChanged = next.plannedStartDate !== currentStartDate || next.plannedEndDate !== currentEndDate;

    let load;
    if (next.allocatedHours !== undefined && next.allocationPercent !== undefined) {
      load = deriveAssignmentLoad(row.OpportunityHours, next.allocatedHours, next.allocationPercent);
    } else if (next.allocatedHours !== undefined) {
      // If user provides explicit assigned hours, derive allocation percent from project total hours.
      load = deriveAssignmentLoad(row.OpportunityHours, next.allocatedHours, undefined);
    } else if (datesChanged) {
      // Timeline broadening/squeezing should recalculate hours from % and business-day duration.
      const effectivePercent = round2(next.allocationPercent ?? Number(row.AllocationPercent));
      load = {
        allocationPercent: effectivePercent,
        allocatedHours: calculateAllocatedHoursByDuration(next.plannedStartDate, next.plannedEndDate, effectivePercent),
      };
    } else {
      // Without date change, allocation percent maps to opportunity total hours.
      load = deriveAssignmentLoad(row.OpportunityHours, undefined, next.allocationPercent ?? row.AllocationPercent);
    }

    const r = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, assignmentId)
      .input("PersonName", sql.NVarChar(200), next.personName)
      .input("PlannedStartDate", sql.Date, next.plannedStartDate)
      .input("PlannedEndDate", sql.Date, next.plannedEndDate)
      .input("AllocationPercent", sql.Float, load.allocationPercent)
      .input("AllocatedHours", sql.Float, load.allocatedHours)
      .input("IsTimelineVisible", sql.Bit, next.isTimelineVisible)
      .query(
        `UPDATE dbo.OpportunityAssignments
         SET PersonName=@PersonName,
             PlannedStartDate=@PlannedStartDate,
             PlannedEndDate=@PlannedEndDate,
             AllocationPercent=@AllocationPercent,
             AllocatedHours=@AllocatedHours,
             IsTimelineVisible=@IsTimelineVisible,
             UpdatedAt=SYSUTCDATETIME()
         WHERE Id=@Id;
         SELECT @@ROWCOUNT as affected;`
      );

    if (r.recordset[0].affected === 0) return res.status(404).json({ error: "Assignment not found" });
    res.json({ ok: true, allocatedHours: load.allocatedHours, allocationPercent: load.allocationPercent });
  } catch (e) {
    if (String(e).includes("Invalid object name 'dbo.OpportunityAssignments'")) {
      return res.status(400).json({
        error: "Missing database migration: run server/sql/004_create_opportunity_assignments.sql",
      });
    }
    res.status(400).json({ error: String(e) });
  }
});

// Delete assignment
app.delete("/assignments/:assignmentId", async (req, res) => {
  try {
    const assignmentId = toGuid(req.params.assignmentId);
    const pool = await getPool();

    const r = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, assignmentId)
      .query(
        `DELETE FROM dbo.OpportunityAssignments
         WHERE Id=@Id;
         SELECT @@ROWCOUNT as affected;`
      );

    if (r.recordset[0].affected === 0) return res.status(404).json({ error: "Assignment not found" });
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes("Invalid object name 'dbo.OpportunityAssignments'")) {
      return res.status(400).json({
        error: "Missing database migration: run server/sql/004_create_opportunity_assignments.sql",
      });
    }
    res.status(400).json({ error: String(e) });
  }
});

// Add note
app.post("/opportunities/:id/notes", async (req, res) => {
  try {
    const opportunityId = toGuid(req.params.id);
    const schema = z.object({
      noteDate: z.string().min(10).max(10), // YYYY-MM-DD
      content: z.string().min(1),
    });
    const body = schema.parse(req.body);

    const newId = require("crypto").randomUUID();
    const pool = await getPool();
    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, newId)
      .input("OpportunityId", sql.UniqueIdentifier, opportunityId)
      .input("NoteDate", sql.Date, body.noteDate)
      .input("Content", sql.NVarChar(sql.MAX), body.content)
      .query(
        `INSERT INTO dbo.OpportunityNotes (Id, OpportunityId, NoteDate, Content)
         VALUES (@Id, @OpportunityId, @NoteDate, @Content);`
      );

    res.status(201).json({ id: newId });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Add next step
app.post("/opportunities/:id/steps", async (req, res) => {
  try {
    const opportunityId = toGuid(req.params.id);
    const schema = z.object({
      title: z.string().min(1).max(250),
      dueDate: z.string().optional().nullable()
    });
    const body = schema.parse(req.body);

    const newId = require("crypto").randomUUID();
    const pool = await getPool();

    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, newId)
      .input("OpportunityId", sql.UniqueIdentifier, opportunityId)
      .input("Title", sql.NVarChar(250), body.title)
      .input("DueDate", sql.Date, body.dueDate ?? null)
      .query(
        `INSERT INTO dbo.OpportunityNextSteps (Id, OpportunityId, Title, DueDate)
         VALUES (@Id, @OpportunityId, @Title, @DueDate);`
      );

    res.status(201).json({ id: newId });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Patch next step 
app.patch("/steps/:stepId", async (req, res) => {
  try {
    const stepId = toGuid(req.params.stepId);
    const schema = z.object({ isDone: z.boolean() });
    const body = schema.parse(req.body);

    const pool = await getPool();
    const r = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, stepId)
      .input("IsDone", sql.Bit, body.isDone)
      .query(
        `UPDATE dbo.OpportunityNextSteps
         SET IsDone=@IsDone
         WHERE Id=@Id;
         SELECT @@ROWCOUNT as affected;`
      );

    if (r.recordset[0].affected === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Delete next step
app.delete("/steps/:stepId", async (req, res) => {
  try {
    const stepId = toGuid(req.params.stepId);
    const pool = await getPool();

    const r = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, stepId)
      .query(
        `DELETE FROM dbo.OpportunityNextSteps
         WHERE Id=@Id;
         SELECT @@ROWCOUNT as affected;`
      );

    if (r.recordset[0].affected === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


// ---- SERVER START (must be OUTSIDE any route) ----
const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
