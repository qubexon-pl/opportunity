const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStepByOpportunity, summariseChargeability, chargeabilityStatus } = require('../src/services/capacityService');
const { nextMonday } = require('../src/routes/opportunities');
const { contentSecurityPolicy } = require('../src/middleware/security');

test('team chargeability leaves out people in Lead positions', () => {
  const member = (role, activeHours) => ({
    role, capacityHours: 100, grossCapacityHours: 100, activeHours, softHours: 0, absenceHours: 0, absentDays: 0,
  });
  const summary = summariseChargeability([
    member('Expert Data Intelligence', 80),
    member('Lead Expert Data Intelligence', 0),
    member('Team lead', 10),
    member('Leadership coach', 60),
  ]);
  assert.equal(summary.excludedLeads, 2);
  assert.equal(summary.real, 70);
});

test('chargeability status is green at target, amber within 10 points, red below', () => {
  assert.equal(chargeabilityStatus(80, 80).tone, 'good');
  assert.equal(chargeabilityStatus(71, 80).tone, 'warn');
  assert.equal(chargeabilityStatus(70, 80).tone, 'warn');
  assert.equal(chargeabilityStatus(69.9, 80).tone, 'bad');
  assert.equal(chargeabilityStatus(101, 80).tone, 'over');
});

test('team chargeability target is weighted by capacity', () => {
  const member = (capacityHours, activeHours, chargeabilityTarget) => ({
    role: 'Expert', capacityHours, grossCapacityHours: capacityHours, activeHours, softHours: 0,
    absenceHours: 0, absentDays: 0, chargeabilityTarget,
  });
  const summary = summariseChargeability([member(150, 135, 90), member(50, 25, 50)]);
  assert.equal(summary.real, 80);
  assert.equal(summary.target, 80);
  assert.equal(summary.status.tone, 'good');
});

test('nextMonday always moves forward to the following Monday', () => {
  assert.equal(nextMonday(new Date(2026, 9, 30)), '2026-11-02'); // Friday
  assert.equal(nextMonday(new Date(2026, 10, 2)), '2026-11-09'); // Monday itself
  assert.equal(nextMonday(new Date(2026, 10, 1)), '2026-11-02'); // Sunday
});

test('nextStepByOpportunity keeps the earliest dated step and flags overdue', () => {
  const today = new Date(2026, 9, 30);
  const map = nextStepByOpportunity([
    { Id: 1, OpportunityId: 'a', Title: 'Later', DueDate: '2026-11-10' },
    { Id: 2, OpportunityId: 'a', Title: 'Sooner', DueDate: '2026-10-20' },
    { Id: 3, OpportunityId: 'b', Title: 'Undated', DueDate: null },
    { Id: 4, OpportunityId: 'c', Title: 'Today', DueDate: '2026-10-30' },
  ], today);
  assert.equal(map.a.stepId, 2);
  assert.equal(map.a.overdue, true);
  assert.equal(map.b.dueText, '');
  assert.equal(map.b.overdue, false);
  assert.equal(map.c.dueToday, true);
});

test('CSP allows scripts only from this origin and the request nonce', () => {
  const policy = contentSecurityPolicy('abc123');
  assert.match(policy, /script-src 'self' 'nonce-abc123'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('formatUnitKey names the period each timeline unit starts', () => {
  const { formatUnitKey } = require('../src/services/dateService');
  assert.equal(formatUnitKey(new Date(Date.UTC(2026, 10, 1)), 'months'), '2026-11');
  assert.equal(formatUnitKey(new Date(Date.UTC(2026, 9, 1)), 'quarters'), '2026-Q4');
  assert.equal(formatUnitKey(new Date(Date.UTC(2026, 6, 1)), 'halfyears'), '2026-H2');
  assert.equal(formatUnitKey(new Date(Date.UTC(2026, 10, 16)), 'weeks'), '2026-W47');
  assert.equal(formatUnitKey(new Date(Date.UTC(2026, 11, 28)), 'weeks'), '2026-W53');
});
