-- Opportunities belong to a team. Each team only sees its own opportunities
-- (and the assignments, notes and next steps under them); admins see all.
--
-- TeamId matches the id of a team in the app settings ('teams'). Rows created
-- before teams existed stay NULL and are read as the default team, so nothing
-- needs backfilling. Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'TeamId') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities ADD TeamId NVARCHAR(64) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Opportunities_TeamId' AND object_id = OBJECT_ID('dbo.Opportunities'))
BEGIN
  CREATE INDEX IX_Opportunities_TeamId ON dbo.Opportunities (TeamId);
END
GO
