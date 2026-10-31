// Loads apps/api/.env for local runs. Variables already set (e.g. in CI) win.
// Jest gives each test file its own copy of process.env, so parse and assign here
// (process.loadEnvFile would write to the real env, which the test sandbox does not see).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const file = join(__dirname, '..', '.env');
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Integration tests never touch the dev database: tests that boot the AppModule use the *_test database for the
// app's runtime connection too (prepare-test-db.mjs refuses any other name).
const TEST_DB_URL = /^postgres(ql)?:\/\/[^/]+\/[a-z0-9_]+_test(\?|$)/;
const testUrl = process.env.TEST_DATABASE_URL ?? '';
if (!TEST_DB_URL.test(testUrl))
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends with _test');
process.env.DATABASE_URL = testUrl;

// With TEST_APP_DATABASE_URL (the runtime role sirat_app on the same *_test database), the app under test connects as
// that role, as production will after L8, so a missing grant fails here and not in production. The test harness
// (testPrisma, truncateAll) stays on TEST_DATABASE_URL, the owner. Without it the app runs as the owner, as before.
const appUrl = process.env.TEST_APP_DATABASE_URL ?? '';
if (appUrl) {
  if (!TEST_DB_URL.test(appUrl) || new URL(appUrl).username !== 'sirat_app')
    throw new Error(
      'TEST_APP_DATABASE_URL must be sirat_app on a database whose name ends with _test',
    );
  process.env.DATABASE_URL = appUrl;
}
