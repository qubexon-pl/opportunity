# Opportunities

Business development workspace for tracking opportunities, next steps, and team capacity.

Server-rendered Express + EJS application (same architecture and design system as the
Power BI Governance app): no client build step, no SPA, everything is rendered on the server.

## Stack

- Node.js + Express 4
- EJS views with Bootstrap 5 and one stylesheet (`src/public/css/main.css`)
- Bootstrap, Bootstrap Icons and the Inter font are installed from npm and served from
  `/vendor/*`, so the app needs no CDN and runs under a strict Content Security Policy
- Azure SQL (`mssql`) for persistence
- `zod` for input validation

## Structure

```
src/
  app.js               Express app wiring (security, sessions, flash, routes, errors)
  server.js            HTTP entry point
  config/settings.js   Environment settings and the people/capacity settings API
  config/store.js      Settings store: Azure SQL (dbo.AppSettings) or config.local.json
  db/pool.js           Azure SQL connection pool
  middleware/          Sign-in (Easy Auth), security headers and rate limiting
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

The migrations in `src/sql/` are applied automatically, in numeric order, the first
time the app connects. They are idempotent, so restarting is safe and there is
nothing to run by hand. If the SQL login cannot execute DDL the app logs a
`[migrate]` warning and keeps running; the management timeline then degrades
gracefully and shows a hint naming the script to apply.

## Configuration

People, daily hours, roles, costs, absences, committed stages and saved view defaults are
edited from the **Configuration** page. When Azure SQL is configured they are stored in
`dbo.AppSettings` (one row per setting), so every instance shares them and a redeploy keeps
them. The first time that table is empty, the contents of `config.local.json` are copied in.
Without SQL the app falls back to `config.local.json` at the repository root (git-ignored).
Each instance re-reads the settings at most every `SETTINGS_REFRESH_MS` (default 5000 ms).

When `AZURE_SQL_USER` and `AZURE_SQL_PASSWORD` are left empty, the app connects to Azure SQL
with its managed identity, so Azure deployments need no database password. The deployment sets
`OPP_CONFIG_FILE` to persistent storage under `/home`, so an ignored local `config.local.json`
is never seeded into the Azure database.

### Sign-in

The app does not run its own login. In Azure, turn on App Service Authentication with
Microsoft Entra ID; the signed-in person's name appears in the top bar and their saved
pipeline defaults are kept per person. Settings:

| Variable | Meaning |
| --- | --- |
| `AUTH_PROVIDER=easyauth` | Trust the Easy Auth headers (detected automatically on App Service) |
| `AUTH_REQUIRED=true` | Refuse requests with nobody signed in |
| `DEV_USER_NAME`, `DEV_USER_EMAIL` | Act as this person locally (ignored in production) |

## Pages

- `/` &mdash; pipeline as a table or a stage board, with inline edits, next steps and Excel export
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
| `npm test` | Run the unit tests (`node --test`) |
| `npm run check` | `check:js` and the tests; this is what CI runs |

## Keyboard

`Ctrl+K` jumps to any opportunity, person or page; `Shift+N` starts a new opportunity;
`Ctrl+S` saves the opportunity form; `?` lists every shortcut.
