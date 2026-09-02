# SQL migration scripts

These run **automatically** the first time the app opens a database connection, in
filename order. Every script is guarded (`IF COL_LENGTH(...) IS NULL`), so re-running
is a no-op and there is nothing to apply by hand.

If the SQL login has no DDL rights the app logs a `[migrate]` warning and keeps
running; apply the pending script manually in that case.

## 001_add_opportunity_hours_timeline.sql
Adds the following nullable columns to `dbo.Opportunities`:
- `OpportunityHours` (`FLOAT`)
- `OpportunityTimeline` (`NVARCHAR(100)`)


## 002_add_opportunity_description.sql
Adds nullable `Description` (`NVARCHAR(4000)`) to `dbo.Opportunities`.


## 003_add_opportunity_planning_fields.sql
Adds nullable planning columns to `dbo.Opportunities`:
- `PlannedStartDate` (`DATE`)
- `PlannedEndDate` (`DATE`)
- `AllocationPercent` (`FLOAT`)


## 004_create_opportunity_assignments.sql
Creates `dbo.OpportunityAssignments` for multi-person scheduling per opportunity.
Includes:
- date range (`PlannedStartDate`, `PlannedEndDate`)
- allocation percentage (`AllocationPercent`)
- computed allocated effort snapshot (`AllocatedHours`)
- timeline visibility (`IsTimelineVisible`) so assignments can be hidden from the timeline without deleting the opportunity.


## 005_add_counts_towards_capacity.sql
Adds nullable `CountsTowardsCapacity` (`BIT`) to `dbo.Opportunities`, so an opportunity can
be soft booked without consuming a person's capacity until it is won.


## 006_add_assignment_hold_window.sql
Adds nullable `HoldStartDate` / `HoldEndDate` (`DATE`) to `dbo.OpportunityAssignments`.
An assignment on hold frees the person's capacity between those dates while keeping its
total allocated hours.


## 007_add_assignment_allocation_mode.sql
Adds nullable `AllocationMode` (`NVARCHAR(20)`) to `dbo.OpportunityAssignments`, recording
whether the allocation was entered as `percent`, `total-hours` or `monthly-hours` so the edit
form reopens in the same unit. Legacy rows are `NULL` and are treated as `percent`.

