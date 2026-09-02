-- Adds scheduling fields for capacity planning.
-- Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'PlannedStartDate') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD PlannedStartDate DATE NULL;
END;
GO

IF COL_LENGTH('dbo.Opportunities', 'PlannedEndDate') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD PlannedEndDate DATE NULL;
END;
GO

IF COL_LENGTH('dbo.Opportunities', 'AllocationPercent') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD AllocationPercent FLOAT NULL;
END;
GO
