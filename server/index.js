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
  techOwner: z.string().max(200).optional().nullable(),
  businessOwner: z.string().max(200).optional().nullable(),
  firstContactDate: z.string().optional().nullable(), // YYYY-MM-DD

  stage: z.string().max(60).optional().nullable(),
  status: z.string().max(30).optional().nullable(),
  priority: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.string().max(400).optional().nullable(),

  nextStepSummary: z.string().max(500).optional().nullable(),
  nextStepDueDate: z.string().optional().nullable(), // YYYY-MM-DD
});

function toGuid(id) {
  // Validate it’s a GUID
  return z.string().uuid().parse(id);
}

// List opportunities (simple search/sort)
app.get("/opportunities", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const sort = (req.query.sort || "updated").toString(); // updated|created|name
  const dir = (req.query.dir || "desc").toString().toLowerCase() === "asc" ? "ASC" : "DESC";

  const sortColumn =
    sort === "name" ? "Name" : sort === "created" ? "CreatedAt" : "UpdatedAt";

  try {
    const pool = await getPool();
    const r = await pool
      .request()
      .input("q", sql.NVarChar(220), q ? `%${q}%` : null)
      .query(
        `
        SELECT TOP 500 *
        FROM dbo.Opportunities
        WHERE (@q IS NULL OR Name LIKE @q OR TechOwner LIKE @q OR BusinessOwner LIKE @q OR Tags LIKE @q)
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

    res.json({ opportunity: opp.recordset[0], notes: notes.recordset, nextSteps: steps.recordset });
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
      .input("TechOwner", sql.NVarChar(200), body.techOwner ?? null)
      .input("BusinessOwner", sql.NVarChar(200), body.businessOwner ?? null)
      .input("FirstContactDate", sql.Date, body.firstContactDate ?? null)
      .input("Stage", sql.NVarChar(60), body.stage ?? null)
      .input("Status", sql.NVarChar(30), body.status ?? null)
      .input("Priority", sql.Int, body.priority ?? null)
      .input("Tags", sql.NVarChar(400), body.tags ?? null)
      .input("NextStepSummary", sql.NVarChar(500), body.nextStepSummary ?? null)
      .input("NextStepDueDate", sql.Date, body.nextStepDueDate ?? null)
      .query(
        `
        INSERT INTO dbo.Opportunities
          (Id, Name, TechnologyStack, TechOwner, BusinessOwner, FirstContactDate, Stage, Status, Priority, Tags, NextStepSummary, NextStepDueDate)
        VALUES
          (@Id, @Name, @TechnologyStack, @TechOwner, @BusinessOwner, @FirstContactDate, @Stage, @Status, @Priority, @Tags, @NextStepSummary, @NextStepDueDate);
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
      .input("TechOwner", sql.NVarChar(200), body.techOwner ?? null)
      .input("BusinessOwner", sql.NVarChar(200), body.businessOwner ?? null)
      .input("FirstContactDate", sql.Date, body.firstContactDate ?? null)
      .input("Stage", sql.NVarChar(60), body.stage ?? null)
      .input("Status", sql.NVarChar(30), body.status ?? null)
      .input("Priority", sql.Int, body.priority ?? null)
      .input("Tags", sql.NVarChar(400), body.tags ?? null)
      .input("NextStepSummary", sql.NVarChar(500), body.nextStepSummary ?? null)
      .input("NextStepDueDate", sql.Date, body.nextStepDueDate ?? null)
      .query(
        `
        UPDATE dbo.Opportunities
        SET
          Name=@Name,
          TechnologyStack=@TechnologyStack,
          TechOwner=@TechOwner,
          BusinessOwner=@BusinessOwner,
          FirstContactDate=@FirstContactDate,
          Stage=@Stage,
          Status=@Status,
          Priority=@Priority,
          Tags=@Tags,
          NextStepSummary=@NextStepSummary,
          NextStepDueDate=@NextStepDueDate
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
