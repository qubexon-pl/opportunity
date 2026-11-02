-- Indexes for the pipeline's default sort orders, so listing the most recently
-- updated or created opportunities doesn't scan the whole table.
-- Safe to run multiple times.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Opportunities_UpdatedAt' AND object_id = OBJECT_ID('dbo.Opportunities'))
BEGIN
  CREATE INDEX IX_Opportunities_UpdatedAt ON dbo.Opportunities (UpdatedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Opportunities_CreatedAt' AND object_id = OBJECT_ID('dbo.Opportunities'))
BEGIN
  CREATE INDEX IX_Opportunities_CreatedAt ON dbo.Opportunities (CreatedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OpportunityNextSteps_Open' AND object_id = OBJECT_ID('dbo.OpportunityNextSteps'))
BEGIN
  CREATE INDEX IX_OpportunityNextSteps_Open ON dbo.OpportunityNextSteps (OpportunityId, IsDone, DueDate);
END
GO
