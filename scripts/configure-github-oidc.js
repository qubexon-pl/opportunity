#!/usr/bin/env node
'use strict';

/**
 * Sets up passwordless (OIDC) deployment from GitHub Actions.
 *
 * Creates an Entra app registration whose federated credential trusts pushes to
 * one branch of one repository, grants it the roles `azd up` needs, and prints
 * the values the workflow expects. No client secret is ever issued.
 *
 * Usage:
 *   node scripts/configure-github-oidc.js --repo owner/name [--branch main]
 *
 * Re-running is safe: every step reuses what already exists.
 */

const { execFileSync } = require('child_process');

const CONTRIBUTOR = 'Contributor';
const RBAC_ADMIN = 'Role Based Access Control Administrator';
const RBAC_ADMIN_FALLBACK = 'User Access Administrator';

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

function assignRole(role, principalId, scope) {
  try {
    az([
      'role', 'assignment', 'create',
      '--assignee-object-id', principalId,
      '--assignee-principal-type', 'ServicePrincipal',
      '--role', role,
      '--scope', scope,
    ], { quiet: true });
    console.log(`  granted ${role}`);
    return true;
  } catch (err) {
    const detail = `${err.stderr || ''}${err.stdout || ''}`;
    if (/already exists|RoleAssignmentExists/i.test(detail)) {
      console.log(`  ${role} already granted`);
      return true;
    }
    console.log(`  could not grant ${role}: ${detail.trim().split('\n')[0]}`);
    return false;
  }
}

function main() {
  const repo = arg('repo');
  const branch = arg('branch') || 'main';
  const appName = arg('name') || 'opportunities-github-deploy';
  const group = arg('group') || process.env.AZURE_RESOURCE_GROUP;

  if (!repo || !repo.includes('/')) {
    throw new Error('Need --repo in owner/name form.');
  }

  const account = azJson(['account', 'show']);
  const subscriptionId = arg('subscription') || account.id;
  const tenantId = account.tenantId;

  console.log(`Repository:   ${repo} (branch ${branch})`);
  console.log(`Subscription: ${account.name} (${subscriptionId})`);

  const existing = azJson(['ad', 'app', 'list', '--display-name', appName]) || [];
  let clientId;
  if (existing.length > 0) {
    clientId = existing[0].appId;
    console.log(`Reusing app registration ${clientId}`);
  } else {
    console.log(`Creating app registration "${appName}"...`);
    clientId = azJson(['ad', 'app', 'create', '--display-name', appName]).appId;
  }

  const servicePrincipals = azJson(['ad', 'sp', 'list', '--filter', `appId eq '${clientId}'`]) || [];
  let principalId;
  if (servicePrincipals.length > 0) {
    principalId = servicePrincipals[0].id;
  } else {
    principalId = azJson(['ad', 'sp', 'create', '--id', clientId]).id;
    console.log('Created service principal.');
  }

  const subject = `repo:${repo}:ref:refs/heads/${branch}`;
  const credentials = azJson(['ad', 'app', 'federated-credential', 'list', '--id', clientId]) || [];
  if (credentials.some((c) => c.subject === subject)) {
    console.log('Federated credential already present.');
  } else {
    console.log(`Adding federated credential for ${subject}...`);
    az([
      'ad', 'app', 'federated-credential', 'create',
      '--id', clientId,
      '--parameters', JSON.stringify({
        name: `${repo.split('/')[1]}-${branch}`,
        issuer: 'https://token.actions.githubusercontent.com',
        subject,
        audiences: ['api://AzureADTokenExchange'],
      }),
    ], { quiet: true });
  }

  // `infra/main.bicep` deploys at subscription scope and creates the resource
  // group, so Contributor has to sit on the subscription. The ability to hand
  // out roles is only needed where the Key Vault role assignment lands, so it
  // stays scoped to the resource group when one is known.
  console.log('Assigning roles...');
  assignRole(CONTRIBUTOR, principalId, `/subscriptions/${subscriptionId}`);

  const rbacScope = group
    ? `/subscriptions/${subscriptionId}/resourceGroups/${group}`
    : `/subscriptions/${subscriptionId}`;
  if (!assignRole(RBAC_ADMIN, principalId, rbacScope)) {
    assignRole(RBAC_ADMIN_FALLBACK, principalId, rbacScope);
  }

  console.log('\nDone. Configure the repository with:');
  console.log(`  gh secret set AZURE_CLIENT_ID --body ${clientId}`);
  console.log(`  gh secret set AZURE_TENANT_ID --body ${tenantId}`);
  console.log(`  gh secret set AZURE_SUBSCRIPTION_ID --body ${subscriptionId}`);
}

try {
  main();
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
