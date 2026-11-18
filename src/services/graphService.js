/**
 * Microsoft Graph directory lookup for the Admin "add user" picker.
 *
 * Authenticates as the app identity through DefaultAzureCredential (the App
 * Service managed identity in Azure, the Azure CLI login locally), the same
 * way the SQL connection does. That identity needs the Graph application
 * permission User.ReadBasic.All with admin consent; see README.md. No secret
 * is stored in the app.
 */
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 8000;

let credential = null;
let cachedToken = null;

function graphError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  if (status) err.status = status;
  return err;
}

function getCredential() {
  if (!credential) {
    // Loaded lazily so machines without an Azure identity can still load the module.
    const { DefaultAzureCredential } = require('@azure/identity');
    credential = new DefaultAzureCredential();
  }
  return credential;
}

async function getAccessToken() {
  // Re-request a minute early so a request never starts with an expiring token.
  if (cachedToken && cachedToken.expiresOnTimestamp - Date.now() > 60_000) return cachedToken.token;
  let token;
  let cause = '';
  try {
    token = await getCredential().getToken(GRAPH_SCOPE);
  } catch (err) {
    token = null;
    cause = String((err && err.message) || err || '').split('\n')[0].slice(0, 300);
  }
  if (!token || !token.token) {
    throw graphError(`Could not get a Microsoft Graph token for the app identity${cause ? `: ${cause}` : '.'}`, 'GRAPH_AUTH_FAILED');
  }
  cachedToken = token;
  return token.token;
}

/** $search terms are quoted, so quotes and backslashes are dropped rather than escaped. */
function sanitizeQuery(value) {
  return String(value || '').replace(/["\\]/g, ' ').trim().slice(0, 100);
}

/** Up to `top` directory users matching a partial name or email: [{ email, name }]. */
async function searchDirectoryUsers(query, top = 10) {
  const term = sanitizeQuery(query);
  if (term.length < 2) return [];
  const token = await getAccessToken();

  // $search matches token prefixes, which suits partial typing; it needs ConsistencyLevel: eventual.
  const search = encodeURIComponent(`"displayName:${term}" OR "mail:${term}" OR "userPrincipalName:${term}"`);
  const url = `${GRAPH_BASE}/users?$search=${search}&$select=id,displayName,mail,userPrincipalName&$top=${Number(top) || 10}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual', Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw graphError(
        `The app identity may not read the directory (Graph ${response.status}: ${body.slice(0, 200)}). Grant it the Graph permission User.ReadBasic.All with admin consent.`,
        'GRAPH_FORBIDDEN',
        response.status
      );
    }
    throw graphError(`Microsoft Graph returned ${response.status}: ${body.slice(0, 300)}`, 'GRAPH_REQUEST_FAILED', response.status);
  }

  const payload = await response.json();
  return (payload.value || [])
    .map((user) => ({
      // Guests and some service accounts have no mail; the sign-in name is the dependable fallback.
      email: String(user.mail || user.userPrincipalName || '').trim().toLowerCase(),
      name: String(user.displayName || '').trim(),
    }))
    .filter((user) => user.email);
}

module.exports = { searchDirectoryUsers, sanitizeQuery };
