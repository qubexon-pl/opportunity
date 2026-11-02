const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-store-'));
process.env.CONFIG_FILE = path.join(dir, 'config.local.json');
delete process.env.AZURE_SQL_SERVER;
delete process.env.AZURE_SQL_DATABASE;
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ people: ['Anna'], committedStages: ['Won'] }));

const store = require('../src/config/store');

test('reads config.local.json when SQL is not configured', async () => {
  await store.refresh({ force: true });
  assert.equal(store.currentBackend(), 'file');
  assert.deepEqual(store.snapshot().people, ['Anna']);
});

test('snapshot is a copy, so callers cannot change the cache by accident', async () => {
  const copy = store.snapshot();
  copy.people.push('Bartek');
  assert.deepEqual(store.snapshot().people, ['Anna']);
});

test('save writes through to the file and bumps the version', async () => {
  const before = store.currentVersion();
  const next = store.snapshot();
  next.people = ['Anna', 'Bartek'];
  await store.save(next);
  assert.ok(store.currentVersion() > before);
  const onDisk = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
  assert.deepEqual(onDisk.people, ['Anna', 'Bartek']);
  assert.deepEqual(onDisk.committedStages, ['Won']);
});
