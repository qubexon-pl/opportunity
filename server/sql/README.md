# SQL migration scripts

## 001_add_opportunity_hours_timeline.sql
Adds the following nullable columns to `dbo.Opportunities`:
- `OpportunityHours` (`FLOAT`)
- `OpportunityTimeline` (`NVARCHAR(100)`)

Run once against your target database (script is idempotent).
