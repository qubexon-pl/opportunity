-- Adds the per-opportunity capacity booking override.
--
-- CountsTowardsCapacity:
--   NULL -> follow the configured stage rule (soft unless the stage is marked firm)
--   1    -> always counts towards a person's committed capacity
--   0    -> never counts (soft booking only)
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'CountsTowardsCapacity') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities ADD CountsTowardsCapacity BIT NULL;
END;
GO
