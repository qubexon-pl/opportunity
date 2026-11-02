/**
 * Persistent store for the settings that used to live only in config.local.json:
 * people, daily hours, roles, costs, managers, absences, committed stages and
 * saved view defaults.
 *
 * Reads are synchronous and come from an in-memory copy, so the capacity maths
 * can keep calling getConfig() as often as it likes without touching the disk
 * or the database. Writes go through to the backing store:
 *
 * - Azure SQL (dbo.AppSettings, one row per top-level key) whenever SQL is
 *   configured and the table exists. Every instance reads the same rows, and a
 *   redeploy no longer wipes what people entered.
 * - config.local.json otherwise, which keeps local development working with no
 *   database at all.
 *
 * The first time the SQL table is found empty, whatever config.local.json holds
 * is copied into it, so switching over loses nothing.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, '..', '..', 'config.local.json');

/* Other instances may have written since we last looked. Re-reading at most
   this often keeps every request cheap while changes still show up within a
   few seconds everywhere. */
const REFRESH_MS = Number(process.env.SETTINGS_REFRESH_MS || 5000);

let cache = null;
let loadedAt = 0;
let backend = 'file';
let refreshing = null;
let sqlUnavailableLogged = false;
/* Bumped whenever the in-memory copy changes, so readers can memoise. */
let version = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch (err) {
    console.error('[Settings] Error loading config file:', err.message);
  }
  return {};
}

function writeFile(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function sqlConfigured() {
  return !!(process.env.AZURE_SQL_SERVER && process.env.AZURE_SQL_DATABASE);
}

/* Loaded lazily: pool.js reads settings too, so a top-level require would loop. */
function db() {
  return require('../db/pool');
}

async function readSql() {
  const { getPool } = db();
  const pool = await getPool();
  const result = await pool.request().query('SELECT SettingKey, SettingValue FROM dbo.AppSettings;');
  const config = {};
  result.recordset.forEach((row) => {
    try {
      config[row.SettingKey] = JSON.parse(row.SettingValue);
    } catch (err) {
      console.warn(`[Settings] Ignoring unreadable setting ${row.SettingKey}: ${err.message}`);
    }
  });
  return { config, empty: result.recordset.length === 0 };
}

async function writeSqlKeys(entries) {
  if (!entries.length) return;
  const { sql, getPool } = db();
  const pool = await getPool();
  for (const [key, value] of entries) {
    const request = pool.request().input('k', sql.NVarChar(200), key);
    if (value === undefined) {
      await request.query('DELETE FROM dbo.AppSettings WHERE SettingKey = @k;');
      continue;
    }
    await request.input('v', sql.NVarChar(sql.MAX), JSON.stringify(value)).query(
      `MERGE dbo.AppSettings AS t
       USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
       WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue) VALUES (@k, @v);`
    );
  }
}

function useFile(reason) {
  if (reason && !sqlUnavailableLogged) {
    console.warn(`[Settings] Using config.local.json: ${reason}`);
    sqlUnavailableLogged = true;
  }
  backend = 'file';
  cache = readFile();
  loadedAt = Date.now();
  version += 1;
}

/**
 * Brings the in-memory copy up to date. Cheap to call on every request: it
 * only goes to the store when the copy is older than REFRESH_MS (or `force`).
 * Never throws; a store that cannot be reached leaves the last good copy.
 */
function refresh({ force = false } = {}) {
  if (!force && cache && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve(cache);
  if (refreshing) return refreshing;

  refreshing = (async () => {
    if (!sqlConfigured()) {
      useFile();
      return cache;
    }
    try {
      const { config, empty } = await readSql();
      if (empty) {
        const fromFile = readFile();
        const entries = Object.entries(fromFile);
        if (entries.length) {
          await writeSqlKeys(entries);
          console.log(`[Settings] Copied ${entries.length} setting(s) from config.local.json into dbo.AppSettings.`);
        }
        cache = fromFile;
      } else {
        cache = config;
      }
      version += 1;
      backend = 'sql';
      loadedAt = Date.now();
      sqlUnavailableLogged = false;
    } catch (err) {
      // No table (DDL not applied) or no connection: keep working from the file
      // rather than taking the app down, and say so once.
      if (backend === 'sql' && cache) {
        console.warn('[Settings] Could not refresh from SQL, keeping the last copy:', err.message || err);
        loadedAt = Date.now();
      } else {
        useFile(err.message || String(err));
      }
    }
    return cache;
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
}

/** A private copy of everything stored. Safe to mutate. */
function snapshot() {
  if (!cache) {
    // Before the first refresh (startup, tests): the file is the best we have.
    cache = readFile();
    loadedAt = 0;
    version += 1;
  }
  return clone(cache);
}

/** The shared in-memory copy, for read-only use. Never mutate the result. */
function peek() {
  if (!cache) snapshot();
  return cache;
}

function currentVersion() {
  if (!cache) snapshot();
  return version;
}

/**
 * Saves a full settings object. Only the keys whose value changed are written,
 * so two people editing different things (one person's absences, another's
 * filters) don't overwrite each other.
 */
async function save(next) {
  const current = cache || readFile();
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [];
  keys.forEach((key) => {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) changed.push([key, clone(next[key])]);
  });

  cache = clone(next);
  version += 1;

  if (backend === 'sql') {
    await writeSqlKeys(changed);
  } else {
    writeFile(cache);
  }
  return changed.map(([key]) => key);
}

function currentBackend() {
  return backend;
}

/** Test hook: forget everything so the next read starts from scratch. */
function reset() {
  cache = null;
  loadedAt = 0;
  backend = 'file';
  refreshing = null;
  sqlUnavailableLogged = false;
  version += 1;
}

module.exports = { CONFIG_FILE, refresh, snapshot, peek, currentVersion, save, currentBackend, reset };
