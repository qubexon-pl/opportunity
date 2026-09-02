const app = require('./app');
const { getConfig, isSqlConfigured } = require('./config/settings');

const config = getConfig();
const port = config.port;

if (!isSqlConfigured()) {
  console.warn('[Server] AZURE_SQL_SERVER / AZURE_SQL_DATABASE are not configured. Copy .env.example to .env first.');
}

// Bind dual-stack (IPv4 + IPv6). Binding to '0.0.0.0' makes Windows' IPv6-first
// resolution of "localhost" fail over, adding ~2s of latency to every request.
app.listen(port, () => {
  console.log(`\n  Opportunities App`);
  console.log(`  ─────────────────`);
  console.log(`  Running at:  http://localhost:${port}`);
  console.log(`  Management:  http://localhost:${port}/management`);
  console.log(`  Settings:    http://localhost:${port}/settings\n`);
});
