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
const testUrl = process.env.TEST_DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\/[^/]+\/[a-z0-9_]+_test(\?|$)/.test(testUrl))
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends with _test');
process.env.DATABASE_URL = testUrl;
