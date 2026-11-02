const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-entropy';
process.env.AZURE_SQL_SERVER = 'opportunities.database.windows.net';
process.env.AZURE_SQL_DATABASE = 'opportunities';
delete process.env.AZURE_SQL_USER;
delete process.env.AZURE_SQL_PASSWORD;

const { validateConfig } = require('../src/config/settings');

test('production configuration accepts Azure SQL managed identity without SQL credentials', () => {
  assert.doesNotThrow(() => validateConfig({ requireProductionSecrets: true }));
});
