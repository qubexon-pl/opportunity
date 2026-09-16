-- Adds a JSON column that stores multiple hold periods per assignment.
--
-- Holds (NVARCHAR(MAX)):
--   NULL or '[]'  -> no hold periods; assignment is active for its whole window
--   JSON array    -> e.g. [{"startDate":"2026-09-07","endDate":"2026-09-10"}]
--
-- Each hold frees the person's capacity between its dates (inclusive) without
-- changing the assignment's stored total hours.
--
-- The older HoldStartDate/HoldEndDate columns are migrated into the new JSON
-- column but are no longer read or written by the application.
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.OpportunityAssignments', 'Holds') IS NULL
BEGIN
  ALTER TABLE dbo.OpportunityAssignments ADD Holds NVARCHAR(MAX) NULL;
END
GO

-- Migrate existing single-hold data into the new JSON column.
UPDATE dbo.OpportunityAssignments
SET Holds = '[{"startDate":"' + CONVERT(VARCHAR(10), HoldStartDate, 120) + '","endDate":"' + CONVERT(VARCHAR(10), HoldEndDate, 120) + '"}]'
WHERE Holds IS NULL
  AND HoldStartDate IS NOT NULL
  AND HoldEndDate IS NOT NULL;
GO
