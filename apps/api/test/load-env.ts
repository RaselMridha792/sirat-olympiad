// Loads apps/api/.env for local runs. Variables already set (e.g. in CI) win.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '..', '.env');
if (existsSync(file)) process.loadEnvFile(file);
