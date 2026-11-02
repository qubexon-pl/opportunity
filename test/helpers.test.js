const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStepByOpportunity } = require('../src/services/capacityService');
const { nextMonday } = require('../src/routes/opportunities');
const { contentSecurityPolicy } = require('../src/middleware/security');

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
