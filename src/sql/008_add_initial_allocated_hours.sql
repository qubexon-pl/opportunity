-- Remembers the allocation as it was originally defined, so a timeline resize
-- can change the real hours without losing what was agreed.
--
-- InitialAllocatedHours:
--   set   -> the hours entered on the assignment form
--   NULL  -> legacy row; fall back to AllocationPercent x OpportunityHours
--
-- AllocationPercent keeps its meaning (a share of the opportunity's total
-- hours) and describes InitialAllocatedHours. AllocatedHours is the live
-- figure that follows the bar and drives capacity.
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.OpportunityAssignments', 'InitialAllocatedHours') IS NULL
BEGIN
  ALTER TABLE dbo.OpportunityAssignments ADD InitialAllocatedHours FLOAT NULL;
END;
GO

-- Backfill existing rows from whatever they were last saved with.
UPDATE dbo.OpportunityAssignments
SET InitialAllocatedHours = AllocatedHours
WHERE InitialAllocatedHours IS NULL AND AllocatedHours IS NOT NULL;
GO
