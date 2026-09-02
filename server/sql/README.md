# SQL migration scripts

## 001_add_opportunity_hours_timeline.sql
Adds the following nullable columns to `dbo.Opportunities`:
- `OpportunityHours` (`FLOAT`)
- `OpportunityTimeline` (`NVARCHAR(100)`)

Run once against your target database (script is idempotent).

## 002_add_opportunity_description.sql
Adds nullable `Description` (`NVARCHAR(4000)`) to `dbo.Opportunities`.

Run once against your target database (script is idempotent).

## 003_add_opportunity_planning_fields.sql
Adds nullable planning columns to `dbo.Opportunities`:
- `PlannedStartDate` (`DATE`)
- `PlannedEndDate` (`DATE`)
- `AllocationPercent` (`FLOAT`)

Run once against your target database (script is idempotent).

## 004_create_opportunity_assignments.sql
Creates `dbo.OpportunityAssignments` for multi-person scheduling per opportunity.
Includes:
- date range (`PlannedStartDate`, `PlannedEndDate`)
- allocation percentage (`AllocationPercent`)
- computed allocated effort snapshot (`AllocatedHours`)
- timeline visibility (`IsTimelineVisible`) so assignments can be hidden from timeline without deleting the opportunity.

Run once against your target database (script is idempotent).
