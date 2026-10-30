// Prepares the dedicated integration-test database: creates it if missing, then applies all migrations.
// Non-destructive (no reset/drop). Refuses any database whose name does not end with `_test`.
import { execFileSync } from 'node:child_process';
import prismaPkg from '@prisma/client';

const { PrismaClient } = prismaPkg;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set (see apps/api/.env.example).');
  process.exit(1);
}
const testUrl = new URL(url);
const dbName = testUrl.pathname.replace(/^\//, '');
if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  console.error(`Refusing: the test database name must end with _test (got "${dbName}").`);
  process.exit(1);
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
try {
  const rows = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (rows.length === 0) {
    // dbName is validated by the regex above, so interpolating it as an identifier is safe.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`created database ${dbName}`);
  }
} finally {
  await admin.$disconnect();
}

execFileSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  shell: process.platform === 'win32', // prisma is a .cmd shim on Windows
});
