-- Creates assignment table that allows assigning one opportunity to multiple people.
-- Includes timeline visibility flag so assignment can be removed from timeline only.
-- Safe to run multiple times.

IF OBJECT_ID('dbo.OpportunityAssignments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OpportunityAssignments (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    OpportunityId UNIQUEIDENTIFIER NOT NULL,
    PersonName NVARCHAR(200) NOT NULL,
    PlannedStartDate DATE NOT NULL,
    PlannedEndDate DATE NOT NULL,
    AllocationPercent FLOAT NOT NULL,
    AllocatedHours FLOAT NOT NULL,
    IsTimelineVisible BIT NOT NULL CONSTRAINT DF_OpportunityAssignments_IsTimelineVisible DEFAULT(1),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_OpportunityAssignments_CreatedAt DEFAULT(SYSUTCDATETIME()),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_OpportunityAssignments_UpdatedAt DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT FK_OpportunityAssignments_Opportunity FOREIGN KEY (OpportunityId)
      REFERENCES dbo.Opportunities(Id) ON DELETE CASCADE,
    CONSTRAINT CK_OpportunityAssignments_DateRange CHECK (PlannedEndDate >= PlannedStartDate),
    CONSTRAINT CK_OpportunityAssignments_Allocation CHECK (AllocationPercent > 0 AND AllocationPercent <= 100),
    CONSTRAINT CK_OpportunityAssignments_AllocatedHours CHECK (AllocatedHours >= 0)
  );

  CREATE INDEX IX_OpportunityAssignments_PersonStart
    ON dbo.OpportunityAssignments (PersonName, PlannedStartDate);

  CREATE INDEX IX_OpportunityAssignments_Opportunity
    ON dbo.OpportunityAssignments (OpportunityId);
END;
GO
