/**
 * Puts Entra ID sign-in in front of the web app.
 *
 * The app has no login of its own, so this uses App Service's built-in
 * authentication: unauthenticated requests never reach the app at all. Only
 * accounts in your tenant get through.
 *
 * Run after provisioning:
 *   node scripts/configure-auth.js --app <web-app-name> --group <resource-group>
 *
 * Safe to re-run; it reuses the existing app registration if one is there.
 */
const { execFileSync } = require('child_process');

function arg(flag) {
  const i = process.argv.indexOf(`--${flag}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Node 20+ refuses to execFile `.cmd` wrappers directly on Windows, so route
// through cmd.exe with explicit quoting instead.
function winQuote(value) {
  return /[\s"^&|<>()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function az(args, { quiet = false } = {}) {
  const options = {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  };
  const out = process.platform === 'win32'
    ? execFileSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `"${['az', ...args].map(winQuote).join(' ')}"`],
      { ...options, windowsVerbatimArguments: true }
    )
    : execFileSync('az', args, options);
  return out.trim();
}

function azJson(args) {
  const out = az([...args, '-o', 'json'], { quiet: true });
  return out ? JSON.parse(out) : undefined;
}

function main() {
  const appName = arg('app') || process.env.WEB_APP_NAME;
  const group = arg('group') || process.env.AZURE_RESOURCE_GROUP;

  if (!appName || !group) {
    throw new Error('Need --app and --group (or WEB_APP_NAME and AZURE_RESOURCE_GROUP).');
  }

  const site = azJson(['webapp', 'show', '--name', appName, '--resource-group', group]);
  const host = site.defaultHostName;
  const callback = `https://${host}/.auth/login/aad/callback`;
  const tenantId = azJson(['account', 'show']).tenantId;
  const displayName = `${appName}-auth`;

  console.log(`Web app:   https://${host}`);
  console.log(`Tenant:    ${tenantId}`);

  let registration = (azJson(['ad', 'app', 'list', '--display-name', displayName]) || [])[0];

  if (registration) {
    console.log(`Reusing app registration ${registration.appId}`);
    az(['ad', 'app', 'update', '--id', registration.appId, '--web-redirect-uris', callback], { quiet: true });
  } else {
    console.log(`Creating app registration "${displayName}"...`);
    registration = azJson([
      'ad', 'app', 'create',
      '--display-name', displayName,
      '--web-redirect-uris', callback,
      '--sign-in-audience', 'AzureADMyOrg',
      '--enable-id-token-issuance', 'true',
    ]);
  }

  const clientId = registration.appId;

  // A service principal in this tenant is what actually grants users access.
  const existingSp = (azJson(['ad', 'sp', 'list', '--filter', `appId eq '${clientId}'`]) || [])[0];
  if (!existingSp) {
    az(['ad', 'sp', 'create', '--id', clientId], { quiet: true });
    console.log('Created service principal.');
  }

  console.log('Issuing a client secret...');
  const credential = azJson([
    'ad', 'app', 'credential', 'reset',
    '--id', clientId,
    '--display-name', 'app-service-auth',
    '--years', '2',
  ]);

  console.log('Applying authentication settings...');
  // A site with no auth configured still reports auth v1; the v2 command group
  // refuses to run until the config version is upgraded. This is a no-op when
  // the site is already on v2.
  try {
    az([
      'webapp', 'auth', 'config-version', 'upgrade',
      '--name', appName,
      '--resource-group', group,
    ], { quiet: true });
  } catch (err) {
    const detail = `${err.stderr || ''}${err.stdout || ''}`;
    if (!/already|v2/i.test(detail)) throw err;
  }

  az([
    'webapp', 'auth', 'microsoft', 'update',
    '--name', appName,
    '--resource-group', group,
    '--client-id', clientId,
    '--client-secret', credential.password,
    '--issuer', `https://login.microsoftonline.com/${tenantId}/v2.0`,
    '--yes',
  ], { quiet: true });

  az([
    'webapp', 'auth', 'update',
    '--name', appName,
    '--resource-group', group,
    '--enabled', 'true',
    '--action', 'RedirectToLoginPage',
    '--redirect-provider', 'azureactivedirectory',
    '--unauthenticated-client-action', 'RedirectToLoginPage',
    // The platform health probe is unauthenticated, so it has to stay reachable
    // or every instance gets marked unhealthy.
    '--excluded-paths', '["/health"]',
  ], { quiet: true });

  console.log(`\nDone. https://${host} now requires an Entra ID sign-in.`);
  console.log('The client secret expires in 2 years; re-run this script to roll it.');
}

try {
  main();
} catch (err) {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
}
