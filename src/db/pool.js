const sql = require('mssql');
const { getConfig, isSqlConfigured } = require('../config/settings');

let poolPromise;

function buildConfig() {
  const cfg = getConfig().sql;
  return {
    server: cfg.server,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: false,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

async function getPool() {
  if (!isSqlConfigured()) {
    const error = new Error('Database is not configured. Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE (see .env.example).');
    error.code = 'DB_NOT_CONFIGURED';
    throw error;
  }

  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig()).catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

const UNAVAILABLE_CODES = new Set(['DB_NOT_CONFIGURED', 'ESOCKET', 'ELOGIN', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINSTLOOKUP']);

/** True when the failure is an infrastructure problem rather than a bad query. */
function isDatabaseUnavailable(error) {
  if (!error) return false;
  if (UNAVAILABLE_CODES.has(error.code)) return true;
  const text = String(error.message || error);
  return text.includes('Invalid object name') || text.includes('Failed to connect');
}

const MISSING_ASSIGNMENTS_TABLE = "Invalid object name 'dbo.OpportunityAssignments'";

function isMissingAssignmentsTable(error) {
  return String(error).includes(MISSING_ASSIGNMENTS_TABLE);
}

module.exports = { sql, getPool, isMissingAssignmentsTable, isDatabaseUnavailable };
