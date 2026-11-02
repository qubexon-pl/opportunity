const test = require('node:test');
const assert = require('node:assert/strict');
const { userFromEasyAuth, resolveUser } = require('../src/middleware/auth');

function principal(claims) {
  return Buffer.from(JSON.stringify({ claims })).toString('base64');
}

test('reads name, email and object id from the Easy Auth principal', () => {
  const user = userFromEasyAuth({
    'x-ms-client-principal': principal([
      { typ: 'name', val: 'Anna Wacholak' },
      { typ: 'preferred_username', val: 'anna@example.com' },
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'oid-1' },
    ]),
  });
  assert.deepEqual(user, { id: 'oid-1', name: 'Anna Wacholak', email: 'anna@example.com', provider: 'easyauth' });
});

test('falls back to the plain principal headers', () => {
  const user = userFromEasyAuth({ 'x-ms-client-principal-name': 'b@example.com', 'x-ms-client-principal-id': 'id-2' });
  assert.equal(user.id, 'id-2');
  assert.equal(user.email, 'b@example.com');
});

test('a garbled principal is ignored rather than throwing', () => {
  assert.equal(userFromEasyAuth({ 'x-ms-client-principal': 'not base64 json' }), null);
});

test('Easy Auth headers are not trusted unless Easy Auth is enabled', () => {
  const saved = { ...process.env };
  try {
    delete process.env.AUTH_PROVIDER;
    delete process.env.WEBSITE_AUTH_ENABLED;
    delete process.env.DEV_USER_NAME;
    delete process.env.DEV_USER_EMAIL;
    const req = { headers: { 'x-ms-client-principal-name': 'spoof@example.com' } };
    assert.equal(resolveUser(req), null);
    process.env.AUTH_PROVIDER = 'easyauth';
    assert.equal(resolveUser(req).email, 'spoof@example.com');
  } finally {
    process.env = saved;
  }
});
