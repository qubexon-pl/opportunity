const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-access-'));
process.env.CONFIG_FILE = path.join(dir, 'config.local.json');
delete process.env.OPP_CONFIG_FILE;
delete process.env.AZURE_SQL_SERVER;
delete process.env.AZURE_SQL_DATABASE;
delete process.env.ADMIN_EMAILS;
process.env.NODE_ENV = 'test';

const store = require('../src/config/store');
const access = require('../src/services/accessService');
const people = require('../src/services/peopleService');

async function resetConfig(config) {
  fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(config));
  store.reset();
  await store.refresh({ force: true });
}

function asMember(teamId, fn) {
  return access.runWithScope(access.buildScope({ role: 'member', teamId }, ''), fn);
}

test('only listed people get in: nobody becomes admin just by signing in first', async () => {
  await resetConfig({});
  const first = access.resolveAccess({ email: 'First@Example.com' });
  assert.equal(first.allowed, false);
  assert.equal(first.reason, 'not-listed');

  await access.saveUser({ email: 'first@example.com', role: 'admin' }, 'first@example.com');
  assert.deepEqual(access.resolveAccess({ email: 'first@example.com' }).role, 'admin');
  const stranger = access.resolveAccess({ email: 'someone@example.com' });
  assert.equal(stranger.allowed, false);
  assert.equal(stranger.reason, 'not-listed');
});

test('ADMIN_EMAILS grants admin even when the list says member', async () => {
  await resetConfig({ appUsers: [{ email: 'boss@example.com', role: 'member' }, { email: 'a@example.com', role: 'admin' }] });
  process.env.ADMIN_EMAILS = 'boss@example.com';
  try {
    assert.equal(access.resolveAccess({ email: 'boss@example.com' }).role, 'admin');
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
});

test('the last admin cannot be removed or demoted', async () => {
  await resetConfig({ appUsers: [{ email: 'admin@example.com', role: 'admin' }, { email: 'm@example.com', role: 'member' }] });
  await assert.rejects(access.removeUser('admin@example.com'), /At least one admin/);
  await assert.rejects(access.saveUser({ email: 'admin@example.com', role: 'member' }, 'x'), /At least one admin/);
  await access.removeUser('m@example.com');
  assert.equal(access.listUsers().length, 1);
});

test('members are scoped to their team; admins see all unless they pick a team', async () => {
  await resetConfig({ teams: [{ id: 't2', name: 'Second' }] });
  assert.equal(access.buildScope({ role: 'admin', teamId: 'default' }, '').all, true);
  assert.equal(access.buildScope({ role: 'admin', teamId: 'default' }, 't2').teamId, 't2');
  assert.equal(access.buildScope({ role: 'admin', teamId: 'default' }, 'gone').all, true);
  const member = access.buildScope({ role: 'member', teamId: 't2' }, 'default');
  assert.equal(member.teamId, 't2');
  assert.equal(member.all, false);

  const inputs = [];
  const fakeRequest = { input: (...args) => inputs.push(args) };
  assert.equal(access.teamFilterSql(fakeRequest, 'o.TeamId', 'type'), '');
  const clause = asMember('t2', () => access.teamFilterSql(fakeRequest, 'o.TeamId', 'type'));
  assert.match(clause, /COALESCE\(o\.TeamId, 'default'\) = @scopeTeamId/);
  assert.deepEqual(inputs[0], ['scopeTeamId', 'type', 't2']);
});

test('people in several teams see all of them, can narrow to one, and keep old single-team entries', async () => {
  await resetConfig({
    teams: [{ id: 't2', name: 'Second' }, { id: 't3', name: 'Third' }],
    appUsers: [{ email: 'old@example.com', role: 'member', teamId: 't3' }, { email: 'a@example.com', role: 'admin' }],
  });
  await access.saveUser({ email: 'multi@example.com', role: 'member', teamIds: ['t2', 'default'] }, 'a@example.com');
  await assert.rejects(access.saveUser({ email: 'none@example.com', teamIds: [] }, 'a'), /at least one team/);

  const multi = access.resolveAccess({ email: 'multi@example.com' });
  assert.deepEqual(multi.teamIds, ['t2', 'default']);
  assert.deepEqual(access.resolveAccess({ email: 'old@example.com' }).teamIds, ['t3']);
  assert.deepEqual(access.teamsFor(multi).map((team) => team.id).sort(), ['default', 't2']);

  const both = access.buildScope(multi, '');
  assert.deepEqual(both.teamIds, ['default', 't2']);
  assert.equal(access.buildScope(multi, 't2').teamIds.join(), 't2');
  assert.deepEqual(access.buildScope(multi, 't3').teamIds, ['default', 't2']);

  const inputs = [];
  const clause = access.runWithScope(both, () => {
    assert.equal(access.teamVisible('t2'), true);
    assert.equal(access.teamVisible('t3'), false);
    return access.teamFilterSql({ input: (...args) => inputs.push(args) }, 'TeamId', 'type');
  });
  assert.match(clause, /IN \(@scopeTeamId0, @scopeTeamId1\)/);
  assert.deepEqual(inputs.map((args) => args[2]), ['default', 't2']);

  await assert.rejects(access.removeTeam('t2'), /1 user/);
});

test('people are listed per team, new people join the creator team and names stay unique', async () => {
  await resetConfig({ teams: [{ id: 't2', name: 'Second' }], people: ['Anna', 'Bartek'], personTeams: { Bartek: 't2' } });

  assert.deepEqual(asMember('default', () => people.listPeople()), ['Anna']);
  assert.deepEqual(asMember('t2', () => people.listPeople()), ['Bartek']);
  assert.deepEqual(people.listPeople().sort(), ['Anna', 'Bartek']);

  await asMember('t2', () => people.addPerson('Celina', 8));
  assert.equal(access.personTeam('Celina'), 't2');
  await assert.rejects(asMember('t2', () => people.addPerson('Anna', 8)), /another team/);
  await assert.rejects(asMember('t2', () => people.removePerson('Anna')), /not in this team/);

  await people.movePersonToTeam('Anna', 't2');
  assert.deepEqual(asMember('t2', () => people.listPeople()).sort(), ['Anna', 'Bartek', 'Celina']);
});

test('a team with members or people cannot be removed', async () => {
  await resetConfig({ teams: [{ id: 't2', name: 'Second' }], people: ['Anna'], personTeams: { Anna: 't2' } });
  await assert.rejects(access.removeTeam('t2'), /1 person/);
  await assert.rejects(access.removeTeam('default'), /cannot be removed/);
  await people.movePersonToTeam('Anna', 'default');
  await access.removeTeam('t2');
  assert.deepEqual(access.listTeams().map((team) => team.id), ['default']);
});
