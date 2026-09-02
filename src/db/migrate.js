const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql');

let applied;

/** Splits a script on its `GO` batch separators, the way sqlcmd would. */
function toBatches(script) {
  return script
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();
}

/**
 * Applies every migration in order, once per process.
 *
 * All scripts are guarded (`IF COL_LENGTH(...) IS NULL`), so re-running them is
 * a no-op. This keeps a deployed database in step with the code instead of
 * failing later with "Invalid column name" on the first write that needs a new
 * column.
 *
 * A failure here is not fatal: the account may lack DDL rights, in which case
 * the app still works for everything the existing schema supports.
 */
async function runMigrations(pool) {
  if (applied) return applied;

  applied = (async () => {
    const results = [];
    for (const name of listMigrations()) {
      const script = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      try {
        for (const batch of toBatches(script)) {
          await pool.request().batch(batch);
        }
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, error: err.message || String(err) });
        console.warn(`[migrate] ${name} could not be applied: ${err.message || err}`);
      }
    }
    return results;
  })().catch((err) => {
    applied = undefined;
    throw err;
  });

  return applied;
}

module.exports = { runMigrations, toBatches, listMigrations };
