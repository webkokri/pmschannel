import { config } from 'dotenv';
import path from 'node:path';

// Tests run against the same Postgres as dev (embedded-postgres via `npm run db`).
// They namespace all their fixtures with a unique prefix and clean up after.
config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set — start the dev database with `npm run db` first.');
}
