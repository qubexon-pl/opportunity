-- Remembers how an allocation was entered so the edit form can reopen it the
-- same way it was created.
--
-- AllocationMode:
--   'percent'       -> the user typed a share of the opportunity's total hours
--   'total-hours'   -> the user typed the hours for the whole period
--   'monthly-hours' -> the user typed hours per month
--   NULL            -> legacy row, treated as 'percent'
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.OpportunityAssignments', 'AllocationMode') IS NULL
BEGIN
  ALTER TABLE dbo.OpportunityAssignments ADD AllocationMode NVARCHAR(20) NULL;
END;
GO
