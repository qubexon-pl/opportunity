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
- timeline visibility (`IsTimelineVisible`) so assignments can be hidden from the timeline without deleting the opportunity.

Run once against your target database (script is idempotent).

## 005_add_counts_towards_capacity.sql
Adds nullable `CountsTowardsCapacity` (`BIT`) to `dbo.Opportunities`, so an opportunity can
be soft booked without consuming a person's capacity until it is won.

Run once against your target database (script is idempotent).

## 006_add_assignment_hold_window.sql
Adds nullable `HoldStartDate` / `HoldEndDate` (`DATE`) to `dbo.OpportunityAssignments`.
An assignment on hold frees the person's capacity between those dates while keeping its
total allocated hours.

Run once against your target database (script is idempotent).

## 007_add_assignment_allocation_mode.sql
Adds nullable `AllocationMode` (`NVARCHAR(20)`) to `dbo.OpportunityAssignments`, recording
whether the allocation was entered as `percent`, `total-hours` or `monthly-hours` so the edit
form reopens in the same unit. Legacy rows are `NULL` and are treated as `percent`.

Run once against your target database (script is idempotent).
