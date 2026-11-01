// Enrols one local-stack admin or manager in two-factor login for the e2e scripts (RUNBOOK section 21), through the
// API, and keeps its authenticator secret in apps/web/.e2e-totp.json (git-ignored, mode 600). The secret and the
// recovery codes are never printed. Once per account after the stack runs with TOTP_ENCRYPTION_KEY; the e2e scripts'
// logins (lib/cdp.mjs apiLogin, e2e.mjs) then pass the code step by themselves.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... pnpm --filter @sirat/web e2e:2fa-enrol [baseUrl]
//
// Only against this machine (127.0.0.1, localhost or ::1). Exit: 0 enrolled (or already, with a kept secret);
// 1 refused or failed; 2 usage.
import { apiLogin } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';
import { hasSecret, nextCode, saveSecret, secretOf } from './lib/totp.mjs';

const BASE = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080';
const email = process.env.E2E_ADMIN_EMAIL ?? '';
const password = process.env.E2E_ADMIN_PASSWORD ?? '';
if (!isLoopbackUrl(BASE)) {
  console.error('e2e-2fa-enrol: the base URL is not on this machine; nothing was sent');
  process.exit(2);
}
if (!email || !password) {
  console.error('e2e-2fa-enrol: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  process.exit(2);
}

const cookieHeader = (cookies) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

async function post(cookies, path, body) {
  return fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: {
      cookie: cookieHeader(cookies),
      'content-type': 'application/json',
      'x-requested-with': 'sirat-web',
    },
    body: JSON.stringify(body),
  });
}

try {
  if (hasSecret(email)) {
    await apiLogin(BASE, email, password); // passes the code step with the kept secret, or throws
    console.log(
      `e2e-2fa-enrol: ${email} is already enrolled; the kept secret passes the code step`,
    );
    process.exit(0);
  }
  const cookies = await apiLogin(BASE, email, password).catch((error) => {
    if (/no authenticator secret/.test(error.message))
      throw new Error(
        `${email} is enrolled, but its secret is not kept here: reset it (admin:2fa-reset, RUNBOOK section 21), then run this again`,
      );
    throw error;
  });
  const setup = await post(cookies, '/auth/2fa/setup', { password });
  if (setup.status === 503)
    throw new Error('two-factor login is off on this stack (no TOTP_ENCRYPTION_KEY)');
  if (setup.status !== 200) throw new Error(`setup answered ${setup.status}`);
  const secret = secretOf((await setup.json()).otpauthUri ?? '');
  if (!secret) throw new Error('setup returned no secret');
  saveSecret(email, secret);
  const enable = await post(cookies, '/auth/2fa/enable', { code: await nextCode(email) });
  if (enable.status !== 200) {
    saveSecret(email, null);
    throw new Error(`enable answered ${enable.status}`);
  }
  await apiLogin(BASE, email, password); // the code step now works with the kept secret
  console.log(
    `e2e-2fa-enrol: ${email} enrolled; its secret is in apps/web/.e2e-totp.json (never printed). Its recovery codes were not kept.`,
  );
} catch (error) {
  console.error(`e2e-2fa-enrol: ${error.message}`);
  process.exit(1);
}
