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
