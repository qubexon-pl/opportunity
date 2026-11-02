-- Moves the settings that used to live in config.local.json (people, daily
-- hours, roles, costs, managers, absences, committed stages, saved view
-- defaults) into the database, so they survive redeploys and are the same on
-- every instance.
--
-- One row per top-level setting; SettingValue holds its JSON. Saved view
-- defaults are stored per signed-in person under 'viewDefaults:user:<id>'.
--
-- The app copies an existing config.local.json into this table the first time
-- it finds the table empty. Safe to run multiple times.

IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppSettings (
    SettingKey NVARCHAR(200) NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY,
    SettingValue NVARCHAR(MAX) NOT NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AppSettings_UpdatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO
