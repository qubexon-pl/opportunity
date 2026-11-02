/**
 * Grants the app's managed identity access inside the Azure SQL database.
 *
 * The identity can reach the server as soon as it exists, but it still needs a
 * user inside the database itself. This creates that user and gives it the
 * rights the app needs: read and write data, plus DDL so the migrations in
 * src/sql can apply themselves on first connection.
 *
 * Run after provisioning, signed in as the server's Entra admin:
 *   node scripts/grant-sql-access.js
 *
 * Reads AZURE_SQL_SERVER, AZURE_SQL_DATABASE and WEB_IDENTITY_NAME from the
 * environment, or takes them as --server / --database / --identity arguments.
 */
const { execFileSync } = require('child_process');
const sql = require('mssql');

const ROLES = ['db_datareader', 'db_datawriter', 'db_ddladmin'];

function arg(flag) {
  const i = process.argv.indexOf(`--${flag}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Node 20+ refuses to execFile `.cmd` wrappers directly on Windows, so route
// through cmd.exe with explicit quoting instead.
function winQuote(value) {
  return /[\s"^&|<>()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function azExec(args, options) {
  if (process.platform === 'win32') {
    const line = ['az', ...args].map(winQuote).join(' ');
    return execFileSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `"${line}"`],
      { ...options, windowsVerbatimArguments: true }
    );
  }
  return execFileSync('az', args, options);
}

function getAccessToken() {
  const raw = azExec(
    ['account', 'get-access-token', '--resource', 'https://database.windows.net/', '-o', 'json'],
    { encoding: 'utf8' }
  );
  return JSON.parse(raw).accessToken;
}

async function main() {
  const server = arg('server') || process.env.AZURE_SQL_SERVER;
  const database = arg('database') || process.env.AZURE_SQL_DATABASE;
  const identity = arg('identity') || process.env.WEB_IDENTITY_NAME;

  if (!server || !database || !identity) {
    throw new Error('Need --server, --database and --identity (or the matching environment variables).');
  }

  // The identity name goes into the statement directly because T-SQL will not
  // take a parameter there, so reject anything that is not a plain name.
  if (!/^[A-Za-z0-9-_]+$/.test(identity)) {
    throw new Error(`Refusing to use "${identity}" as an identity name.`);
  }

  console.log(`Connecting to ${database} on ${server} as the Entra admin...`);
  const pool = await sql.connect({
    server,
    database,
    authentication: { type: 'azure-active-directory-access-token', options: { token: getAccessToken() } },
    options: { encrypt: true, trustServerCertificate: false },
  });

  const exists = await pool
    .request()
    .input('name', sql.NVarChar, identity)
    .query('SELECT 1 FROM sys.database_principals WHERE name = @name');

  if (exists.recordset.length) {
    console.log(`User [${identity}] already exists.`);
  } else {
    await pool.request().batch(`CREATE USER [${identity}] FROM EXTERNAL PROVIDER`);
    console.log(`Created user [${identity}].`);
  }

  for (const role of ROLES) {
    await pool.request().batch(`ALTER ROLE ${role} ADD MEMBER [${identity}]`);
    console.log(`  granted ${role}`);
  }

  await pool.close();
  console.log('\nDone. The app can now reach the database without a password.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
});
