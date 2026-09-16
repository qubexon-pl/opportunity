-- Adds a user-defined OPP ID (business key) to each opportunity.
--
-- If a previous version of this migration created OppId as INT IDENTITY,
-- we drop that column and recreate it as a free-text NVARCHAR(50).
-- If the column doesn't exist yet, we just add it.
--
-- Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'OppId') IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.Opportunities')
       AND name = 'OppId'
       AND is_identity = 1
   )
BEGIN
  ALTER TABLE dbo.Opportunities DROP COLUMN OppId;
END;
GO

IF COL_LENGTH('dbo.Opportunities', 'OppId') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities ADD OppId NVARCHAR(50) NULL;
END;
GO
