# Azure Deployment Plan

> **Status:** Deployed

Generated: 2026-11-02 12:23

---

## 1. Project Overview

**Goal:** Host the Opportunities app (Express 4 + EJS) on Azure, reusing the existing `opportunities` Azure SQL database that the team already develops against.

**Path:** Add Components (existing codebase, no Azure assets yet)

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Development / internal team use |
| Scale | Small — single instance, internal users |
| Budget | Cost-Optimized |
| **Subscription** | Data Team Subscription (`863d33c0-89ac-47c2-88d7-06200e36f0c2`) ✅ confirmed |
| **Location** | Germany West Central ✅ confirmed (co-located with the database) |

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| opportunities | Web app (server-rendered) | Node.js ≥18, Express 4, EJS | `src/` |
| Azure SQL | Database (**existing — reused, not provisioned**) | `data-team-sql-server` / `opportunities` | `src/db/` |

**Already Azure-ready:** `trust proxy`, `secure`/`sameSite` cookies, `/health` endpoint, `PORT` from env, self-applying SQL migrations on first connection (`src/db/migrate.js`).

---

## 4. Recipe Selection

**Selected:** AZD (Bicep)

**Rationale:**
- Single-service app with no existing IaC or `az` scripts → the default recipe applies.
- `azd up` handles provision + deploy in one step, and `azd deploy` covers later code pushes.
- Bicep keeps the infrastructure declarative and reviewable in the repo.

---

## 5. Architecture

**Stack:** App Service (code deploy, no container — avoids an ACR and image build for a plain Node app)

### Service Mapping

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| opportunities web app | App Service (Linux, Node 20 LTS) | B1 Basic |
| — hosting plan | App Service Plan (Linux) | B1 |
| database | **Existing** Azure SQL Database | unchanged |

### Supporting Services

| Service | Purpose |
|---------|---------|
| User-assigned Managed Identity | Passwordless auth to Azure SQL and Key Vault |
| Key Vault (RBAC) | Holds `SESSION_SECRET` |
| Log Analytics | Centralized logging |
| Application Insights | Monitoring & APM |
| App Service Authentication (Entra ID) | Sign-in gate — the app has no login of its own |

### Access control

The app has **no authentication in its own code**; sessions carry only flash messages. Left open, anyone with the hostname could read and edit the pipeline, including per-person internal cost figures. App Service Authentication is therefore enabled so unauthenticated requests never reach the app, restricted to this tenant (`AzureADMyOrg`). `/health` is excluded so the platform health probe still works.

### Two app changes required

**1. Writable config path.** `src/config/settings.js` writes `config.local.json` to the repo root. That holds *all* people settings — names, daily hours, roles, internal costs, managers and **absences** — plus saved filter defaults. App Service serves the deployed app from a read-only package, so every Settings save, absence assignment and "save as default" would fail with `EROFS`.

*Fix:* honour an optional `OPP_CONFIG_FILE` env var, defaulting to today's path. Set it to `/home/data/config.local.json`, which is App Service's persistent, backed-up storage.

**2. Passwordless SQL.** `src/db/pool.js` only supports SQL username/password.

*Fix:* when no `AZURE_SQL_USER`/`AZURE_SQL_PASSWORD` is configured, use the managed identity (`azure-active-directory-msi-app-service`, already supported by the installed `tedious` 20.0.0 — verified). Local development with user/password is unaffected. This means **no database password is stored anywhere**.

Supporting facts already verified on the server:
- Entra admin is set and is the signed-in account, so the contained DB user can be created.
- The `AllowAllWindowsAzureIps` firewall rule already permits App Service outbound — no firewall change needed.
- Entra-only auth is off, so existing SQL-auth logins keep working.

### Known limitation (accepted at this scale)

Sessions use the default in-memory store, so scaling beyond one instance would sign users out. The B1 plan stays at a single instance; moving to multiple instances later needs a shared session store.

---

## 6. Provisioning Limit Checklist

### Phase 1: Resource Inventory

| Resource Type | Number to Deploy |
|---------------|------------------|
| Microsoft.Web/serverfarms | 1 |
| Microsoft.Web/sites | 1 |
| Microsoft.ManagedIdentity/userAssignedIdentities | 1 |
| Microsoft.KeyVault/vaults | 1 |
| Microsoft.Insights/components | 1 |
| Microsoft.OperationalInsights/workspaces | 1 |
| Microsoft.Resources/resourceGroups | 1 |

### Phase 2: Quotas and Capacity

`az quota list` against `Microsoft.Web` in Germany West Central returned only a wildcard entry (no usable quota resource names), so the documented fallback was used: Azure Resource Graph for current usage plus published service limits.

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Microsoft.Web/serverfarms | 1 | 1 in region (13 in subscription) | 100 per resource group | Resource Graph + official docs (quota CLI unsupported for Microsoft.Web) |
| Microsoft.Web/sites | 1 | 1 in region (11 in subscription) | Unlimited per plan (resource-bound) | Resource Graph + official docs |
| Microsoft.ManagedIdentity/userAssignedIdentities | 1 | 3 in region (13 in subscription) | No documented subscription cap | Resource Graph + official docs |
| Microsoft.KeyVault/vaults | 1 | 2 in region (6 in subscription) | 25,000 per subscription per region | Resource Graph + official docs |
| Microsoft.Insights/components | 1 | 1 in region (14 in subscription) | 100 per subscription | Resource Graph + official docs |
| Microsoft.OperationalInsights/workspaces | 1 | 1 in region (9 in subscription) | No documented subscription cap | Resource Graph + official docs |
| Microsoft.Resources/resourceGroups | 1 | — | 980 per subscription | Official docs |

**Additional capacity checks:**
- B1 Linux SKU confirmed available in Germany West Central (`az appservice list-locations --sku B1 --linux-workers-enabled`).
- All five resource providers confirmed `Registered`.

**Status:** ✅ All resources well within limits (highest utilisation ~14%)

---

## 7. Execution Checklist

### Phase 1: Planning
- [x] Analyze workspace
- [x] Gather requirements
- [x] Confirm subscription and location with user
- [x] Prepare resource inventory
- [x] Fetch quotas and validate capacity
- [x] Scan codebase
- [x] Select recipe
- [x] Plan architecture
- [x] **User approved this plan**

### Phase 2: Execution
- [x] Research components
- [x] Generate `infra/` Bicep + `azure.yaml`
- [x] Apply the two app changes (config path, passwordless SQL)
- [x] Harden security (Entra ID sign-in, HTTPS only, TLS 1.2, FTPS disabled, Key Vault RBAC)
- [x] Update plan status to "Ready for Validation"

### Phase 3: Validation
- [x] Invoke azure-validate skill
- [x] All validation checks pass
- [x] Update status to "Validated" and record proof

### Phase 4: Deployment
- [x] Invoke azure-deploy skill
- [x] Create the contained SQL user for the managed identity
- [x] Configure the Entra ID sign-in gate
- [x] Deployment successful, status "Deployed"

---

## 9. Deployment Record

Deployed: 2026-11-02 13:05 UTC · `azd up` succeeded in 19m 3s (provision 2m 17s, deploy 16m 46s).

| Resource | Name |
|----------|------|
| Resource group | `rg-opportunities-dev` (Germany West Central) |
| Web app | `app-opportunities-dev-bbnp46` |
| App Service plan | `plan-opportunities-dev-bbnp46` (B1 Linux) |
| Managed identity | `id-opportunities-dev-bbnp46` (client ID `ad29b1aa-bcc0-440f-a1a9-f7a0f778f199`) |
| Key Vault | `kv-opportunitie-bbnp46` |
| App Insights | `appi-opportunities-dev-bbnp46` |
| Log Analytics | `log-opportunities-dev-bbnp46` |
| Auth app registration | `app-opportunities-dev-bbnp46-auth` (client ID `77dd17eb-fdbe-46fe-bf11-3f26dd94c371`) |

**URL:** https://app-opportunities-dev-bbnp46.azurewebsites.net

**Post-deploy steps executed:**
1. `node scripts/grant-sql-access.js --server data-team-sql-server.database.windows.net --database opportunities --identity id-opportunities-dev-bbnp46` → created `[id-opportunities-dev-bbnp46]`, granted `db_datareader`, `db_datawriter`, `db_ddladmin`.
2. `node scripts/configure-auth.js --app app-opportunities-dev-bbnp46 --group rg-opportunities-dev` → app registration + service principal + 2-year secret, Easy Auth v2 with `requireAuthentication: true`, `RedirectToLoginPage`, `/health` excluded.
3. `az webapp restart` — required before Easy Auth began enforcing.

**Post-deploy verification:**

| Check | Result |
|-------|--------|
| `GET /health` | ✅ `200 {"status":"healthy",...}` (unauthenticated, as designed) |
| `GET /` unauthenticated | ✅ `302` → `login.microsoftonline.com/.../oauth2/v2.0/authorize` |
| SQL connectivity | ✅ App starts and serves traffic using the managed identity (it crash-looped until the DB user existed) |

**Fixes applied during deployment:**
- Both post-provision scripts invoked `az` through `execFileSync`, which Node 20 refuses for `.cmd` wrappers on Windows (`EINVAL`). They now shell out through `cmd.exe` with `windowsVerbatimArguments` and explicit quoting.
- `configure-auth.js` now runs `az webapp auth config-version upgrade` first; a site with no auth configured reports auth v1, which blocks the v2 command group.

**Known follow-ups:**
- The v1→v2 auth upgrade left Apple/Facebook/GitHub/Google/Twitter providers flagged `enabled` with empty registrations. They are unusable without a client ID, but could be explicitly disabled for tidiness.
- `config.local.json` lives on the App Service `/home` share (`OPP_CONFIG_FILE=/home/data/config.local.json`) and starts empty — people, roles, internal costs and absences must be re-entered in the deployed instance.

---

## 7. Validation Proof

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|
| Tooling | `az version` / `azd version` | ✅ az 2.91.0, azd 1.25.6 | 2026-11-02 12:05 |
| Auth | `azd auth login --check-status` | ✅ Logged in as `admin@SWOTDEMPID302779.onmicrosoft.com` | 2026-11-02 13:48 |
| Bicep compile | `az bicep build --file infra\main.bicep` | ✅ Compiles clean (no errors/warnings) | 2026-11-02 13:10 |
| azd env | `azd env new opportunities-dev` + `azd env set` ×4 | ✅ `AZURE_ENV_NAME`, `AZURE_LOCATION=germanywestcentral`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SQL_SERVER=data-team-sql-server.database.windows.net`, `AZURE_SQL_DATABASE=opportunities` | 2026-11-02 13:50 |
| What-if / preview | `azd provision --preview --no-prompt` | ✅ SUCCESS in 27s. Create: `rg-opportunities-dev`, `appi-opportunities-dev-bbnp46`, `kv-opportunitie-bbnp46`, `log-opportunities-dev-bbnp46`, `plan-opportunities-dev-bbnp46`, `app-opportunities-dev-bbnp46` | 2026-11-02 13:53 |
| Package | `azd package --no-prompt` | ✅ SUCCESS. 0.17 MB zip, 76 entries, **0 `node_modules` entries** (Oryx builds on Azure) | 2026-11-02 13:56 |
| App syntax | `npm run check:js` | ✅ 32 files, no syntax errors | 2026-11-02 13:15 |
| Post-provision scripts | `node --check scripts\grant-sql-access.js` / `scripts\configure-auth.js` | ✅ Both parse clean | 2026-11-02 13:16 |
| Config override | Smoke test with `OPP_CONFIG_FILE` set to a nested path | ✅ Directory created, config written and read back | 2026-11-02 13:18 |
| SQL auth selection | Unit smoke test of `buildConfig()` in `src/db/pool.js` | ✅ MI mode emits `azure-active-directory-msi-app-service` + `clientId`; user/password mode unchanged for local dev | 2026-11-02 13:20 |

**Known deviations:**
- `azd` 1.25.6 honours only directory patterns in `.azdignore`; `README.md`, `config.local.json` and `.git` still ship. Harmless — runtime config is read from `OPP_CONFIG_FILE` on persistent storage, and static serving is limited to `public/`.
- `az quota` has no meaningful data for `Microsoft.Web`; capacity was verified via Azure Resource Graph plus published service limits (section 6).
- `scripts/grant-sql-access.js` and `scripts/configure-auth.js` are syntax-validated only; they can only execute against real provisioned resources (post-deploy step).

---

## 8. Files to Generate

| File | Purpose | Status |
|------|---------|--------|
| `.azure/plan.md` | This plan | ✅ |
| `azure.yaml` | AZD configuration | ✅ |
| `infra/main.bicep` | Subscription-scope entry point | ✅ |
| `infra/main.parameters.json` | AZD parameter wiring | ✅ |
| `infra/modules/resources.bicep` | App Service, identity, Key Vault, monitoring | ✅ |
| `src/config/settings.js` | `OPP_CONFIG_FILE` override | ✅ |
| `src/db/pool.js` | Managed-identity SQL auth | ✅ |
| `.env.example` | Document the new variables | ✅ |
| `.azdignore` | Keep the deployment package lean | ✅ |
| `scripts/grant-sql-access.js` | Create the contained DB user for the identity | ✅ |
| `scripts/configure-auth.js` | Enable Entra ID sign-in | ✅ |

---

## 9. Next Steps

> Current: awaiting plan approval

1. User approves this plan
2. Generate infrastructure and apply the two app changes
3. Hand off to azure-validate, then azure-deploy
