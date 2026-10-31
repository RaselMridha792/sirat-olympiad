// Browser end-to-end test of registration and payment (payments PR 4) with the shared CDP driver: the wizard, the
// FAKE PayStation's checkout (never the sandbox or the live gateway), the callback and the IPN, the worker's status
// check, the result page and the first login. A second run fails the checkout and retries it from the result page.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... pnpm --filter @sirat/web e2e:register [baseUrl]
//
// Needs, all on this machine:
// - the web and the API on one origin: nginx (the stack), or `next dev` with API_INTERNAL_URL pointing its /api
//   rewrite at the API;
// - that API with PAYSTATION_ENV=fake and the fake running (apps/api/test/fake-paystation/run.ts, with
//   FAKE_PAYSTATION_IPN_URL=<baseUrl>/api/payments/paystation/ipn), PAYSTATION_CALLBACK_URL=<baseUrl>/api/payments/
//   paystation/callback and APP_URL=<baseUrl>;
// - its worker (the status checks).
// The admin opens registration for the run and puts the switch back afterwards. Each run leaves two test students
// (e2e-…@test.invalid) and their payments behind. Loopback URLs only.
import { randomBytes, randomInt } from 'node:crypto';
import { apiLogin, launchBrowser } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';

const BASE = (process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(
  /\/+$/,
  '',
);
if (!isLoopbackUrl(BASE)) {
  console.error('e2e-register: the base URL is not on this machine; nothing was sent');
  process.exit(2);
}
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? '',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};
if (!ADMIN.email || !ADMIN.password) {
  console.error('e2e-register: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  process.exit(2);
}

const js = JSON.stringify;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

const hasText = (text) => `!!document.body && document.body.innerText.includes(${js(text)})`;
const buttonWith = (text) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${js(text)}))`;
const click = (page, selector) =>
  page.evaluate(
    `(() => { const el = ${selector}; if (!el) return false; el.click(); return true; })()`,
  );

async function typeInto(page, name, text) {
  const ok = await page.evaluate(
    `(() => { const el = document.querySelector('input[name=${name}]'); if (!el) return false; el.focus(); el.select(); return true; })()`,
  );
  check(ok, `no input ${name}`);
  await page.send('Input.insertText', { text });
}

/** Sets a React-controlled select: the native setter, then the change event React listens to. */
async function choose(page, id, pickValue) {
  const value = await page.evaluate(`(() => {
    const el = document.getElementById(${js(id)});
    if (!el) return null;
    const value = (${pickValue})(el);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()`);
  check(value, `could not choose ${id}`);
}
const firstOption = '(el) => [...el.options].find((o) => o.value)?.value';
/** The wizard's own button (the language switch above it is a form with submit buttons too). */
const SUBMIT = `document.querySelector('#registration-form button[type=submit]')`;

/** Calls the API as the admin (through the same origin as the browser). */
async function adminApi(cookies, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      cookie: `sirat_access=${cookies.sirat_access}`,
      'content-type': 'application/json',
      'x-requested-with': 'sirat-web',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const newStudent = () => ({
  name: 'E2E Student',
  phone: `019${String(randomInt(0, 99_999_999)).padStart(8, '0')}`,
  email: `e2e-${randomBytes(4).toString('hex')}@test.invalid`,
  password: `E2e-${randomBytes(9).toString('base64url')}`,
});

/** Fills the three steps and presses Pay; resolves once the browser shows the fake checkout. */
async function fillAndPay(page, student, fee) {
  await page.goto(`${BASE}/register`);
  await page.waitFor(
    `!!document.querySelector('input[name=name]') && !!document.querySelector('#registration-form button[type=submit]:not([disabled])')`,
  );
  await typeInto(page, 'name', student.name);
  await typeInto(page, 'phone', student.phone);
  await typeInto(page, 'email', student.email);
  await typeInto(page, 'password', student.password);
  check(await click(page, SUBMIT), 'no wizard button');
  await page.waitFor(`!!document.getElementById('district')`);
  await choose(page, 'district', `() => 'Dhaka'`);
  await typeInto(page, 'institution', 'E2E Test School');
  await choose(page, 'educationType', firstOption);
  await choose(page, 'gradeLevelId', firstOption);
  check(await click(page, SUBMIT), 'no wizard button');
  await page.waitFor(hasText(student.email));
  check(!(await page.url()).includes(encodeURIComponent(student.password)), 'password in the URL');
  check(await click(page, SUBMIT), 'no wizard button');
  await page.waitFor(hasText('FAKE PayStation'), { timeout: 30_000 });
  const amount = `BDT ${(fee / 100).toFixed(2)}`;
  check(await page.evaluate(hasText(amount)), `the checkout does not show ${amount}`);
  return new URL(await page.url()).pathname.split('/').pop();
}

console.log(`e2e-register against ${BASE}`);
const admin = await apiLogin(BASE, ADMIN.email, ADMIN.password);
const settings = await adminApi(admin, 'GET', '/admin/settings');
const wasOpen = settings.find((s) => s.key === 'registration_open')?.value === true;
const info = await (await fetch(`${BASE}/api/registrations/info`)).json();
if (!info.fee) {
  console.error('e2e-register: no valid fee or PayStation is not configured (PAYSTATION_ENV=fake)');
  process.exit(2);
}
if (!wasOpen)
  await adminApi(admin, 'PUT', '/admin/settings/registration_open', {
    value: true,
    expected: false,
  });

const browser = await launchBrowser();
try {
  // The page caches the registration info for 30 s: wait until it shows the wizard.
  await step('the register page shows the wizard once registration is open', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (let i = 0; i < 20; i += 1) {
      await page.goto(`${BASE}/register`);
      if (await page.evaluate(`!!document.querySelector('input[name=name]')`)) break;
      await sleep(3_000);
    }
    check(await page.evaluate(`!!document.querySelector('input[name=name]')`), 'no wizard');
    await context.close();
  });

  await step(
    'pays, is registered, logs in from the result page and confirms the free book address',
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const student = newStudent();
      await fillAndPay(page, student, info.fee.amountMinor);
      await click(page, buttonWith('Pay'));
      await page.waitFor(
        `location.pathname === '/register/result' && ${hasText('Registration complete')}`,
        { timeout: 60_000 },
      );
      const reg = (await context.cookies()).find((c) => c.name === 'sirat_reg');
      check(
        reg && reg.httpOnly && reg.path === '/api/registrations',
        'sirat_reg is not httpOnly on its path',
      );
      const stored = await page.evaluate(
        'JSON.stringify(localStorage) + JSON.stringify(sessionStorage)',
      );
      check(
        !stored.includes(student.password) && !stored.includes(student.email),
        'form data in storage',
      );
      // No session after paying (D2): the result page sends the student to log in, then to the free book (plan §16.4).
      check(
        await click(
          page,
          `[...document.querySelectorAll('a')].find((a) => a.textContent.includes('free book'))`,
        ),
        'no "Log in to get your free book" link',
      );
      await page.waitFor(
        `location.pathname === '/login' && !!document.querySelector('button[type=submit]:not([disabled])')`,
      );
      await typeInto(page, 'email', student.email);
      await typeInto(page, 'password', student.password);
      await click(
        page,
        `document.querySelector('input[name=password]').form.querySelector('button[type=submit]')`,
      );
      await page.waitFor(
        // Hydrated: the form's button is enabled only once React runs (typing earlier would be lost).
        `location.pathname === '/dashboard/book' && !!document.querySelector('#book-order-form button[type=submit]:not([disabled])')`,
        { timeout: 30_000 },
      );
      // Pre-filled from the student's own name and phone; the student adds the rest.
      check(
        (await page.evaluate(`document.querySelector('input[name=recipientName]').value`)) ===
          student.name,
        'the recipient is not pre-filled',
      );
      await typeInto(page, 'upazila', 'Mirpur');
      await typeInto(page, 'addressLine', 'House 12, Road 3, Block C');
      await click(page, `document.querySelector('#book-order-form button[type=submit]')`);
      await page.waitFor(hasText('Order confirmed'), { timeout: 20_000 });
      check(await click(page, buttonWith('Change the address')), 'no "Change the address"');
      await page.waitFor(`!!document.querySelector('#book-order-form input[name=upazila]')`);
      await typeInto(page, 'upazila', 'Pallabi');
      await click(page, `document.querySelector('#book-order-form button[type=submit]')`);
      await page.waitFor(hasText('Pallabi') + ` && !document.querySelector('#book-order-form')`, {
        timeout: 20_000,
      });
      await context.close();
    },
  );

  await step(
    'a failed checkout: the result page says so, and "Try again" opens a new checkout',
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const first = await fillAndPay(page, newStudent(), info.fee.amountMinor);
      await click(page, buttonWith('Fail'));
      await page.waitFor(
        `location.pathname === '/register/result' && ${hasText('The payment did not go through')}`,
        { timeout: 60_000 },
      );
      check(await click(page, buttonWith('Try again')), 'no "Try again" button');
      await page.waitFor(hasText('FAKE PayStation'), { timeout: 30_000 });
      const second = new URL(await page.url()).pathname.split('/').pop();
      check(second && second !== first, 'the retry did not open a new invoice');
      await context.close();
    },
  );

  if (typeof browser.cspViolations === 'function') {
    await step('no Content-Security-Policy violation on any page', async () => {
      const violations = await browser.cspViolations();
      check(
        violations.length === 0,
        `${violations.length} CSP violation(s): ${js(violations.slice(0, 3))}`,
      );
    });
  } else {
    console.log('  note  this CDP driver does not record CSP violations yet (A2 L3)');
  }
} finally {
  await browser.close();
  if (!wasOpen)
    await adminApi(admin, 'PUT', '/admin/settings/registration_open', {
      value: false,
      expected: true,
    }).catch((error) =>
      console.error(`e2e-register: could not close registration again: ${error.message}`),
    );
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed ? `e2e-register: ${failed} step(s) failed` : `e2e-register: OK, ${results.length} steps`,
);
process.exit(failed ? 1 : 0);
