const { execFileSync } = require('node:child_process');
const sql = require('mssql');

const server = process.env.SQL_SERVER;
const database = process.env.SQL_DATABASE;
const appName = process.env.APP_SERVICE_NAME;

if (!server || !database || !appName) {
  throw new Error('SQL_SERVER, SQL_DATABASE, and APP_SERVICE_NAME are required.');
}
if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
  throw new Error('APP_SERVICE_NAME contains unsupported characters.');
}

async function grantAccess() {
  const token = execFileSync(
    'az',
    [
      'account',
      'get-access-token',
      '--resource',
      'https://database.windows.net/',
      '--query',
      'accessToken',
      '--output',
      'tsv',
      '--only-show-errors',
    ],
    { encoding: 'utf8' }
  ).trim();
  if (!token) throw new Error('Azure CLI returned an empty Azure SQL access token.');

  const pool = new sql.ConnectionPool({
    server,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  });

  try {
    await pool.connect();
    const sqlName = `[${appName}]`;
    const escapedName = appName.replace(/'/g, "''");
    const roleGrants = ['db_datareader', 'db_datawriter', 'db_ddladmin']
      .map(
        (role) => `
IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members AS drm
  JOIN sys.database_principals AS roles ON roles.principal_id = drm.role_principal_id
  JOIN sys.database_principals AS members ON members.principal_id = drm.member_principal_id
  WHERE roles.name = N'${role}' AND members.name = N'${escapedName}'
)
  EXEC(N'ALTER ROLE [${role}] ADD MEMBER ${sqlName}');
`
      )
      .join('\n');

    await pool.request().batch(`
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'${escapedName}')
  EXEC(N'CREATE USER ${sqlName} FROM EXTERNAL PROVIDER');
${roleGrants}
`);
    console.log(`Granted database access to the App Service identity "${appName}".`);
  } finally {
    await pool.close();
  }
}

grantAccess().catch((error) => {
  console.error('Could not grant Azure SQL access to the App Service identity:', error.message || error);
  process.exitCode = 1;
});
