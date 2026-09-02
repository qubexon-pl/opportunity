-- Adds new nullable fields for opportunity estimation metadata.
-- Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'OpportunityHours') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD OpportunityHours FLOAT NULL;
END;
GO

IF COL_LENGTH('dbo.Opportunities', 'OpportunityTimeline') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD OpportunityTimeline NVARCHAR(100) NULL;
END;
GO
