import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isLoopbackUrl } from './local-only.mjs';

test('only http(s) on 127.0.0.1, localhost or ::1 counts as this machine', () => {
  const local = [
    'http://127.0.0.1:8080',
    'http://localhost:3000/login',
    'https://localhost',
    'http://[::1]:8080/',
    'http://LOCALHOST:8080',
    'http://127.1:8080', // the URL parser turns this into 127.0.0.1
  ];
  const elsewhere = [
    'https://sirat.example.org',
    'http://10.0.0.5:8080',
    'http://0.0.0.0:8080',
    'http://[::ffff:127.0.0.1]:8080',
    'http://localhost.example.org',
    'http://127.0.0.1.example.org',
    'http://localhost:8080@sirat.example.org',
    'ftp://localhost/',
    'localhost:8080',
    '127.0.0.1:8080',
    '',
  ];
  for (const url of local) assert.equal(isLoopbackUrl(url), true, url);
  for (const url of elsewhere) assert.equal(isLoopbackUrl(url), false, url);
});

// The guard must be the first thing e2e.mjs does. These runs leave the password unset, so a missing or late guard
// ends on the password message instead, and the hosts are .invalid, so even a broken guard reaches no server.
const E2E = fileURLToPath(new URL('../e2e.mjs', import.meta.url));
const OWN_ENV = [
  'APP_URL',
  'MAILPIT_URL',
  'E2E_STUDENT_PASSWORD',
  'E2E_ADMIN_EMAIL',
  'E2E_ADMIN_PASSWORD',
];

function runE2e(args, env = {}) {
  const childEnv = { ...process.env };
  for (const key of OWN_ENV) delete childEnv[key];
  return spawnSync(process.execPath, [E2E, ...args], {
    env: { ...childEnv, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

test('e2e.mjs stops before any request when the base URL is not this machine', () => {
  const run = runE2e(['http://sirat-e2e-guard.invalid:8080']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /the base URL is not on this machine/);
  assert.equal(run.stdout, '');
});

test('e2e.mjs stops before any request when MAILPIT_URL is not this machine', () => {
  const run = runE2e(['http://127.0.0.1:9'], {
    MAILPIT_URL: 'http://mail.sirat-e2e-guard.invalid',
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /MAILPIT_URL is not on this machine/);
  assert.equal(run.stdout, '');
});
