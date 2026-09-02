-- Adds opportunity description field.
-- Safe to run multiple times.

IF COL_LENGTH('dbo.Opportunities', 'Description') IS NULL
BEGIN
  ALTER TABLE dbo.Opportunities
    ADD Description NVARCHAR(4000) NULL;
END;
GO
