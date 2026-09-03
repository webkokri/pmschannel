/**
 * Local development database — a real PostgreSQL server with no Docker required.
 *
 *   node scripts/dev-db.mjs         # start (foreground, Ctrl+C to stop)
 *   node scripts/dev-db.mjs stop    # stop a previously started instance
 *
 * Data lives in ./.pgdata so it survives restarts. Connection details come from
 * DEV_DB_* in .env and must line up with DATABASE_URL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';

// Minimal .env loader (avoids a dependency for this bootstrap script)
function loadEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) {
    console.error('Missing .env — copy .env.example to .env first.');
    process.exit(1);
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const port = Number(process.env.DEV_DB_PORT || 55432);
const user = process.env.DEV_DB_USER || 'cm';
const password = process.env.DEV_DB_PASSWORD || 'cm';
const database = process.env.DEV_DB_NAME || 'channel_manager';
const dataDir = path.join(root, '.pgdata');

const { default: EmbeddedPostgres } = await import('embedded-postgres');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: (msg) => process.env.DEV_DB_VERBOSE && console.log(msg),
});

const mode = process.argv[2];

if (mode === 'stop') {
  try {
    await pg.stop();
    console.log('Dev database stopped.');
  } catch (e) {
    console.log('Nothing to stop (' + e.message + ')');
  }
  process.exit(0);
}

const firstRun = !existsSync(dataDir);
if (firstRun) {
  console.log('Initialising Postgres data directory at .pgdata …');
  await pg.initialise();
}

await pg.start();

// Ensure the application database exists.
try {
  await pg.createDatabase(database);
  console.log(`Created database "${database}".`);
} catch {
  /* already exists */
}

console.log('');
console.log('  PostgreSQL is running.');
console.log(`  DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`);
console.log('');
console.log('  Leave this running and, in another terminal:  npm run setup');
console.log('  Press Ctrl+C to stop.');
console.log('');

const shutdown = async () => {
  console.log('\nStopping Postgres …');
  try { await pg.stop(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// keep alive
setInterval(() => {}, 1 << 30);
