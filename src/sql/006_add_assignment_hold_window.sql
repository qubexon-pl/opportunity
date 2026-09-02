-- Adds an optional "on hold" window to an assignment.
--
-- HoldStartDate / HoldEndDate (both inclusive):
--   NULL      -> the assignment is active for its whole planned window
--   set       -> the person's capacity is free between these dates
--
-- The assignment keeps its total allocated hours; only the capacity
-- calculation skips business days that fall inside the hold window.
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.OpportunityAssignments', 'HoldStartDate') IS NULL
BEGIN
  ALTER TABLE dbo.OpportunityAssignments ADD HoldStartDate DATE NULL;
END;
GO

IF COL_LENGTH('dbo.OpportunityAssignments', 'HoldEndDate') IS NULL
BEGIN
  ALTER TABLE dbo.OpportunityAssignments ADD HoldEndDate DATE NULL;
END;
GO
