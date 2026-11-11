// Browser end-to-end test of admin two-factor login against the whole stack behind nginx (RUNBOOK section 22), with
// the shared CDP driver. Needs a stack with TOTP_ENCRYPTION_KEY and a throwaway admin (scripts/... create-admin)
// that has no two-factor login yet:
//
//   E2E_2FA_EMAIL=... E2E_2FA_PASSWORD=... pnpm --filter @sirat/web e2e:2fa [baseUrl]
//
// It covers: an unproved admin sent to /admin/security (and refused by the API), enrolment with the QR page's key,
// the recovery codes, a refresh keeping the proved factor, the login's code step (right and wrong code, a recovery
// code), and turning it off, which leaves the account as it started. The secret goes to apps/web/.e2e-totp.json while
// it runs (lib/totp.mjs) and is forgotten at the end; nothing prints it. Only against this machine. The local stack is
// shared: say so before running this (RUNBOOK §0).
import { apiLogin, cspReport, launchBrowser } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';
import { hasSecret, nextCode, saveSecret } from './lib/totp.mjs';

const BASE = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080';
const ADMIN = {
  email: process.env.E2E_2FA_EMAIL ?? '',
  password: process.env.E2E_2FA_PASSWORD ?? '',
};
if (!isLoopbackUrl(BASE)) {
  console.error('e2e-2fa: the base URL is not on this machine; nothing was sent');
  process.exit(2);
}
if (!ADMIN.email || !ADMIN.password) {
  console.error(
    'e2e-2fa: set E2E_2FA_EMAIL and E2E_2FA_PASSWORD (a throwaway admin without two-factor login)',
  );
  process.exit(2);
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push(true);
    console.log(`  ok    ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push(false);
    console.log(`  FAIL  ${name}: ${error.message}`);
  }
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}

const js = JSON.stringify;
const shows = (path) =>
  `location.pathname + location.search === ${js(path)} && document.readyState === 'complete' && !!document.querySelector('h1, h2')`;
const hasText = (text) => `!!document.body && document.body.innerText.includes(${js(text)})`;
const clickButton = (page, text) =>
  page.evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${js(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`,
  );
const cookieHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');

/** Types into the `index`-th element matching `selector`. */
async function typeInto(page, selector, text, index = 0) {
  const found = await page.evaluate(
    `(() => { const el = document.querySelectorAll(${js(selector)})[${index}]; if (!el) return false; el.focus(); el.select(); return true; })()`,
  );
  check(found, `no ${selector} #${index} on ${await page.url()}`);
  await page.send('Input.insertText', { text });
}

/** Email and password through the login form; resolves once the code step or `expectPath` shows. */
async function passwordStep(page, expectPath) {
  await page.goto(`${BASE}/login`);
  await page.waitFor(`!!document.querySelector('button[type=submit]:not([disabled])')`);
  await typeInto(page, 'input[name=email]', ADMIN.email);
  // Staff sign in with a password: the form opens on the participant ID (students and ambassadors).
  await page.evaluate(
    `[...document.querySelectorAll('button[type=button]')].find((b) => b.textContent.includes('Sign in with a password')).click(), true`,
  );
  await page.waitFor(`!!document.querySelector('input[name=password]')`);
  await typeInto(page, 'input[name=password]', ADMIN.password);
  await page.evaluate(`document.querySelector('button[type=submit]').click(), true`);
  await page.waitFor(`!!document.querySelector('input[name=code]') || (${shows(expectPath)})`, {
    timeout: 20_000,
  });
}

async function submitCode(page, code) {
  await typeInto(page, 'input[name=code], input[name=recoveryCode]', code);
  await page.evaluate(`document.querySelector('button[type=submit]').click(), true`);
}

/** Clicks "Log out" until the browser is on /login: a click before React has hydrated the button does nothing. */
async function logout(page) {
  for (let tries = 0; tries < 20; tries += 1) {
    // false while a logout is pending (the button is disabled): then only wait
    await clickButton(page, 'Log out');
    try {
      await page.waitFor(`location.pathname === '/login'`, { timeout: 1_500 });
      return;
    } catch {
      /* not hydrated yet, or the logout still runs: click again (a second logout is harmless) */
    }
  }
  throw new Error('the logout never reached /login');
}

/** A run that stopped half way leaves the account enrolled: turn it off through the API first. */
async function turnOffIfLeftOn() {
  if (!hasSecret(ADMIN.email)) return;
  const cookies = await apiLogin(BASE, ADMIN.email, ADMIN.password);
  const res = await fetch(`${BASE}/api/auth/2fa/disable`, {
    method: 'POST',
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      'content-type': 'application/json',
      'x-requested-with': 'sirat-web',
    },
    body: JSON.stringify({ password: ADMIN.password, code: await nextCode(ADMIN.email) }),
  });
  if (res.status !== 204 && res.status !== 409)
    throw new Error(`turning off a left-over enrolment answered ${res.status}`);
  saveSecret(ADMIN.email, null);
  console.log('  note  a left-over enrolment from an earlier run was turned off');
}

await turnOffIfLeftOn();
const browser = await launchBrowser();
let recoveryCode = '';
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  await step(
    'an admin without two-factor login lands on /admin/security, the only admin link',
    async () => {
      await passwordStep(page, '/admin/security');
      check(
        !(await page.evaluate(`!!document.querySelector('input[name=code]')`)),
        'the code step showed',
      );
      await page.waitFor(shows('/admin/security'), { timeout: 20_000 });
      await page.waitFor(hasText('must turn on two-factor login'));
      const links = await page.evaluate(
        `[...document.querySelectorAll('a[href^="/admin/"]')].map((a) => a.getAttribute('href'))`,
      );
      check(
        links.every((href) => href === '/admin/security'),
        `other admin links: ${links.join(', ')}`,
      );
    },
  );

  await step('an admin page sends the unproved session to /admin/security', async () => {
    await page.goto(`${BASE}/admin/users`);
    await page.waitFor(shows('/admin/security'), { timeout: 20_000 });
  });

  await step(
    'the API refuses the unproved session on an admin route (403 TWO_FACTOR_REQUIRED)',
    async () => {
      const res = await fetch(`${BASE}/api/admin/users?page=1`, {
        headers: { cookie: cookieHeader(await context.cookies()) },
      });
      check(res.status === 403, `answered ${res.status}`);
      check((await res.json()).code === 'TWO_FACTOR_REQUIRED', 'not TWO_FACTOR_REQUIRED');
    },
  );

  await step(
    'enrolment: password, the QR code and its key, the first code, 10 recovery codes',
    async () => {
      await typeInto(page, 'input[name=password]', ADMIN.password);
      check(await clickButton(page, 'Start the setup'), 'no setup button');
      await page.waitFor(
        `!!document.querySelector('img[src^="data:image/png;base64,"]') && !!document.querySelector('.font-mono')`,
      );
      const key = await page.evaluate(`document.querySelector('.font-mono').textContent`);
      check(/^[A-Z2-7 ]{16,}$/.test(key), 'no manual key on the page');
      saveSecret(ADMIN.email, key.replace(/ /g, ''));
      await typeInto(page, 'input[name=code]', await nextCode(ADMIN.email));
      check(await clickButton(page, 'Turn on'), 'no turn-on button');
      await page.waitFor(`document.querySelectorAll('ol li').length === 10`, { timeout: 20_000 });
      recoveryCode = await page.evaluate(`document.querySelector('ol li').textContent`);
      check(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(recoveryCode), 'the recovery codes look wrong');
      check(await clickButton(page, 'I have stored them'), 'no done button');
      await page.waitFor(shows('/admin'), { timeout: 20_000 });
    },
  );

  await step(
    'a refresh keeps the proved factor (no access cookie: /refresh, then the admin page)',
    async () => {
      await context.deleteCookie('sirat_access');
      await page.goto(`${BASE}/admin/users`);
      await page.waitFor(shows('/admin/users'), { timeout: 30_000 });
    },
  );

  await step('the login asks for the code; the right code opens /admin', async () => {
    await logout(page);
    await passwordStep(page, '/admin');
    check(await page.evaluate(`!!document.querySelector('input[name=code]')`), 'no code step');
    await submitCode(page, await nextCode(ADMIN.email));
    await page.waitFor(shows('/admin'), { timeout: 20_000 });
  });

  await step('a wrong code is refused and the code step stays', async () => {
    await logout(page);
    await passwordStep(page, '/admin');
    await submitCode(page, '000000');
    await page.waitFor(hasText('The code is incorrect'));
    check(
      await page.evaluate(`!!document.querySelector('input[name=code]')`),
      'the code step left',
    );
  });

  await step('a recovery code signs in once', async () => {
    check(await clickButton(page, 'Use a recovery code'), 'no recovery switch');
    await submitCode(page, recoveryCode.toLowerCase());
    await page.waitFor(shows('/admin'), { timeout: 20_000 });
    await page.goto(`${BASE}/admin/security`);
    await page.waitFor(hasText('Unused recovery codes: 9'));
  });

  await step('turning it off sends the admin back to enrolment', async () => {
    await typeInto(page, 'input[name=password]', ADMIN.password);
    await typeInto(page, 'input[name=code]', await nextCode(ADMIN.email), 1); // the second form: turn off
    check(await clickButton(page, 'Turn off'), 'no turn-off button');
    await page.waitFor(
      `${shows('/admin/security')} && ${hasText('must turn on two-factor login')}`,
      {
        timeout: 20_000,
      },
    );
    saveSecret(ADMIN.email, null);
  });
  await context.close();
} finally {
  await browser.close();
}

const csp = cspReport(browser, BASE); // the QR code is a data: image, which the page policy allows
results.push(csp.ok);
console.log(csp.line);

const failed = results.filter((ok) => !ok).length;
console.log(`e2e-2fa: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
