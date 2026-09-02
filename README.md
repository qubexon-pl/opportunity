# Opportunities

Business development workspace for tracking opportunities, next steps, and team capacity.

Server-rendered Express + EJS application (same architecture and design system as the
Power BI Governance app): no client build step, no SPA, everything is rendered on the server.

## Stack

- Node.js + Express 4
- EJS views with Bootstrap 5 and a shared design system (`src/public/css/style.css`)
- Azure SQL (`mssql`) for persistence
- `zod` for input validation

## Structure

```
src/
  app.js               Express app wiring (security, sessions, flash, routes, errors)
  server.js            HTTP entry point
  config/settings.js   Environment + config.local.json settings
  db/pool.js           Azure SQL connection pool
  middleware/          Security headers and rate limiting
  routes/              index (pipeline), opportunities, management, settings, api
  services/            Business logic: dates, people, opportunities, assignments, capacity
  sql/                 Database migrations
  views/               EJS templates (partials/header.ejs, partials/footer.ejs)
  public/              CSS and client-side JavaScript
```

## Getting started

```bash
npm install
cp .env.example .env   # then fill in the Azure SQL settings
npm run dev
```

The app listens on `http://localhost:4000` by default.

## Database

Run the migrations in `src/sql/` in numeric order against your Azure SQL database.
`004_*.sql` creates `dbo.OpportunityAssignments`; until it is applied the management
timeline degrades gracefully and shows a migration hint.

## Configuration

People and their daily working hours are stored in `config.local.json` at the repository
root (created automatically, git-ignored) and are editable from the **Configuration** page.

## Pages

- `/` &mdash; pipeline list with filters and upcoming actions
- `/opportunities/new`, `/opportunities/:id` &mdash; create and edit opportunities, notes, next steps, assignments
- `/management` &mdash; team capacity cards, assignment table, and the allocation timeline
- `/settings` &mdash; people and daily capacity
- `/api/*` &mdash; JSON endpoints used by the client-side timeline helpers
- `/health` &mdash; health probe

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with `--watch` |
| `npm run check:js` | Syntax-check all JavaScript under `src/` and `test/` |
| `npm run check` | Same as `check:js` |
