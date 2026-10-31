// Browser end-to-end test of the web session against the whole stack behind nginx (docker compose, APP_URL),
// with the shared CDP driver (scripts/lib/cdp.mjs) and Mailpit's API for the emailed links. No dependencies.
//
//   E2E_STUDENT_PASSWORD=... [E2E_STUDENT_EMAIL=student1@fixtures.invalid]
//   [E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=...] [MAILPIT_URL=http://127.0.0.1:18025]
//   pnpm --filter @sirat/web e2e [baseUrl]
//
// The local stack is shared: say so before running this (RUNBOOK §0). The reset case sets the student's password
// to the same value again (so the next run still works) and, like every reset, ends that student's sessions; the
// API allows one reset email per address per minute and five per hour. It runs only against this machine: a base
// URL or MAILPIT_URL that is not 127.0.0.1, localhost or ::1 stops it before any request.
import { randomBytes } from 'node:crypto';
import { launchBrowser } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';

const BASE = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
for (const [name, url] of [
  ['the base URL', BASE],
  ['MAILPIT_URL', MAILPIT],
]) {
  if (!isLoopbackUrl(url)) {
    console.error(
      `e2e: ${name} is not on this machine (only 127.0.0.1, localhost or ::1); nothing was sent`,
    );
    process.exit(2);
  }
}
const STUDENT = {
  email: process.env.E2E_STUDENT_EMAIL ?? 'student1@fixtures.invalid',
  password: process.env.E2E_STUDENT_PASSWORD ?? '',
};
const ADMIN =
  process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD
    ? { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
    : null;
if (!STUDENT.password) {
  console.error('e2e: set E2E_STUDENT_PASSWORD (the fixture password)');
  process.exit(2);
}

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

const js = JSON.stringify;
const here = async (page) => {
  const u = new URL(await page.url());
  return u.pathname + u.search;
};
/** True once the page shows `path` (path + query) fully loaded with a heading. */
const shows = (path) =>
  `location.pathname + location.search === ${js(path)} && document.readyState === 'complete' && !!document.querySelector('h1, h2')`;
const hasText = (text) => `!!document.body && document.body.innerText.includes(${js(text)})`;
const buttonWith = (text) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${js(text)}))`;

async function typeInto(page, selector, text) {
  await page.evaluate(
    `(() => { const el = document.querySelector(${js(selector)}); el.focus(); el.select(); return true; })()`,
  );
  await page.send('Input.insertText', { text });
}

/** Through the login form, starting at `loginPath`; resolves once the browser shows `expectPath`. */
async function uiLogin(page, user, loginPath, expectPath) {
  await page.goto(BASE + loginPath);
  await page.waitFor(`!!document.querySelector('button[type=submit]:not([disabled])')`);
  await typeInto(page, 'input[name=email]', user.email);
  await typeInto(page, 'input[name=password]', user.password);
  await page.evaluate(`document.querySelector('button[type=submit]').click(), true`);
  await page.waitFor(shows(expectPath), { timeout: 20_000 });
}

async function loggedInContext(browser, user = STUDENT, landing = '/dashboard') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await uiLogin(page, user, '/login', landing);
  return { context, page };
}

const hasCookie = async (context, name) => (await context.cookies()).some((c) => c.name === name);

/** Pauses this page's refresh requests (or their answers); `onPaused` decides what to do with each. */
async function interceptRefresh(page, onPaused, requestStage = 'Request') {
  await page.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/auth/refresh', requestStage }],
  });
  return page.onEvent('Fetch.requestPaused', onPaused);
}

/** Refresh answers seen by this page (statuses, in order). */
function watchRefreshAnswers(page) {
  const statuses = [];
  page.onEvent('Network.responseReceived', ({ response }) => {
    if (response.url.endsWith('/api/auth/refresh')) statuses.push(response.status);
  });
  return statuses;
}

async function newestMail(to) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search answered ${res.status}`);
  const { messages = [] } = await res.json();
  return messages[0] ?? null;
}

async function waitForNewMail(to, previousId, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const mail = await newestMail(to);
    if (mail && mail.ID !== previousId) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`);
      return res.json();
    }
    await sleep(500);
  }
  throw new Error(
    `no new email to ${to} (the API sends one reset email per address per minute, five per hour)`,
  );
}

console.log(`e2e against ${BASE}`);
const browser = await launchBrowser();
try {
  await step('login keeps a safe next and never puts the password in a URL', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await uiLogin(page, STUDENT, '/login?next=%2Fdashboard%2Fprofile', '/dashboard/profile');
    check(
      !(await page.url()).includes(encodeURIComponent(STUDENT.password)),
      'password in the URL',
    );
    check(await hasCookie(context, 'sirat_access'), 'no access cookie after login');
    await context.close();
  });

  await step('an expired access cookie: the page goes to /refresh and comes back', async () => {
    const { context, page } = await loggedInContext(browser);
    await context.deleteCookie('sirat_access');
    await page.goto(`${BASE}/dashboard/exam`);
    await page.waitFor(shows('/dashboard/exam'));
    check(await hasCookie(context, 'sirat_access'), 'the access cookie was not renewed');
    await context.close();
  });

  await step('next= attack strings never leave the site', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await uiLogin(page, STUDENT, '/login?next=%2F%2Fevil.example%2Fdashboard', '/dashboard');
    await page.close();
    // Each string in its own tab: they all fall back to /dashboard, and the loop guard rightly allows only two
    // renewals per page per tab. Encoded once, so the page really receives the backslash and the tab character.
    for (const next of [
      'https://evil.example/dashboard',
      '/\\evil.example',
      '/\t/evil.example',
      '//evil.example/dashboard',
    ]) {
      const tab = await context.newPage();
      await context.deleteCookie('sirat_access');
      await tab.goto(`${BASE}/refresh?next=${encodeURIComponent(next)}`);
      await tab.waitFor(shows('/dashboard'));
      check(
        new URL(await tab.url()).origin === new URL(BASE).origin,
        `left the site for ${js(next)}`,
      );
      await tab.close();
    }
    await context.close();
  });

  await step(
    'each area is for its roles: a student is sent home, a restricted page is not found',
    async () => {
      const { context, page } = await loggedInContext(browser);
      await page.goto(`${BASE}/admin/users`);
      await page.waitFor(shows('/dashboard'));
      await page.goto(`${BASE}/dashboard/ambassador`);
      await page.waitFor(hasText('Page not found'));
      check((await here(page)) === '/dashboard/ambassador', 'not found should stay on the page');
      await context.close();
      if (ADMIN) {
        const admin = await loggedInContext(browser, ADMIN, '/admin');
        await admin.page.goto(`${BASE}/dashboard/profile`);
        await admin.page.waitFor(shows('/admin'));
        await admin.context.close();
      } else console.log('        (no E2E_ADMIN_*: the admin side of this case was skipped)');
    },
  );

  await step(
    'a refresh that answers 503 shows "connection problem" and never goes to /login',
    async () => {
      const { context, page } = await loggedInContext(browser);
      await context.deleteCookie('sirat_access');
      const off = await interceptRefresh(page, ({ requestId }) =>
        page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(
            '{"statusCode":503,"code":"SERVICE_UNAVAILABLE","message":"x"}',
          ).toString('base64'),
        }),
      );
      await page.goto(`${BASE}/dashboard/leaderboard`);
      await page.waitFor(hasText('Connection problem'));
      await sleep(3000);
      check(
        (await here(page)).startsWith('/refresh?next='),
        `left /refresh for ${await here(page)}`,
      );
      off();
      await page.send('Fetch.disable');
      // The button shows only between tries; an automatic try may also get there first.
      await page.waitFor(
        `!!${buttonWith('Try again now')} || location.pathname === '/dashboard/leaderboard'`,
      );
      await page.evaluate(`(() => { ${buttonWith('Try again now')}?.click(); return true; })()`);
      await page.waitFor(shows('/dashboard/leaderboard'));
      await context.close();
    },
  );

  await step(
    'a slow API: the refresh answer held 15 s after the rotation still lands on the page, never on /login',
    async () => {
      const { context, page } = await loggedInContext(browser);
      await context.deleteCookie('sirat_access');
      const answers = watchRefreshAnswers(page);
      const visited = [];
      const offNav = page.onEvent('Page.frameNavigated', ({ frame }) => {
        if (!frame.parentId) visited.push(new URL(frame.url).pathname);
      });
      // The API has rotated and answered; the browser holds the answer 15 s before the page sees it. Chrome stores
      // the cookies when the headers arrive, before this pause, so this proves the page waits for the answer and
      // never leaves for /login; that the POST is never aborted is pinned by src/lib/auth/refresh-browser.test.ts.
      const offHold = await interceptRefresh(
        page,
        ({ requestId }) =>
          setTimeout(() => {
            page.send('Fetch.continueRequest', { requestId }).catch(() => {});
          }, 15_000),
        'Response',
      );
      const started = Date.now();
      await page.goto(`${BASE}/dashboard/profile`);
      await page.waitFor(hasText('The server is slow to answer'), { timeout: 14_000 });
      check(
        !(await page.evaluate(hasText('Sign in instead'))),
        'offered "Sign in instead" while the renewal was in flight',
      );
      await page.waitFor(shows('/dashboard/profile'), { timeout: 40_000 });
      check(Date.now() - started >= 15_000, 'the answer was not held');
      check(!visited.includes('/login'), `went to /login (${visited.join(' > ')})`);
      check(answers.join() === '204', `refresh answers were ${answers.join(', ')}, want one 204`);
      offHold();
      await page.send('Fetch.disable');
      // The session lives on: the next page needs no other renewal.
      await page.goto(`${BASE}/dashboard/exam`);
      await page.waitFor(shows('/dashboard/exam'));
      check(answers.length === 1, 'the next page needed another refresh');
      offNav();
      await context.close();
    },
  );

  await step('two tabs refreshing at once (409 for one): both end on their pages', async () => {
    const { context, page: first } = await loggedInContext(browser);
    const second = await context.newPage();
    // Without Web Locks both tabs refresh at the same moment with the same cookie, as on older phones.
    for (const page of [first, second]) {
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source:
          "Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });",
      });
    }
    await context.deleteCookie('sirat_access');
    const paused = [];
    const statuses = [...[first, second].map(watchRefreshAnswers)];
    for (const page of [first, second]) {
      await interceptRefresh(page, ({ requestId }) => paused.push({ page, requestId }));
    }
    await Promise.all([
      first.goto(`${BASE}/dashboard/profile`),
      second.goto(`${BASE}/dashboard/exam`),
    ]);
    const end = Date.now() + 15_000;
    while (paused.length < 2 && Date.now() < end) await sleep(50);
    check(paused.length === 2, `only ${paused.length} refresh request(s) were held`);
    await Promise.all(
      paused.map(({ page, requestId }) => page.send('Fetch.continueRequest', { requestId })),
    );
    await first.waitFor(shows('/dashboard/profile'));
    await second.waitFor(shows('/dashboard/exam'));
    const seen = statuses.flat().sort();
    check(
      seen.includes(204) && seen.includes(409),
      `refresh answers were ${seen.join(', ')}, want 204 and 409`,
    );
    await context.close();
  });

  await step(
    'logout with an expired access token: renewed first, then out in every tab',
    async () => {
      const { context, page } = await loggedInContext(browser);
      const other = await context.newPage();
      await other.goto(`${BASE}/dashboard/profile`);
      await other.waitFor(shows('/dashboard/profile'));
      await context.deleteCookie('sirat_access');
      await page.waitFor(`!!${buttonWith('Log out')}`);
      await page.evaluate(`${buttonWith('Log out')}.click(), true`);
      await page.waitFor(shows('/login'));
      await other.waitFor(`location.pathname === '/login'`);
      check(!(await hasCookie(context, 'sirat_refresh')), 'the refresh cookie is still there');
      await page.goto(`${BASE}/dashboard`);
      await page.waitFor(shows('/login?next=%2Fdashboard'));
      await context.close();
    },
  );

  await step(
    'verify-email: a bad link offers sign-in and a new link; the token leaves the address bar',
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const token = randomBytes(32).toString('base64url');
      await page.goto(`${BASE}/verify-email#token=${token}`);
      await page.waitFor(
        `!!${buttonWith('Verify my email')} && !${buttonWith('Verify my email')}.disabled`,
      );
      check((await page.evaluate('location.hash')) === '', 'the token is still in the address bar');
      await page.evaluate(`${buttonWith('Verify my email')}.click(), true`);
      await page.waitFor(hasText('This link is invalid or has expired.'));
      check(await page.evaluate(hasText('Already verified? Sign in.')), 'no sign-in link');
      check(await page.evaluate(`!!document.querySelector('input[name=email]')`), 'no resend form');
      // A new link opened in the same tab changes only the fragment (no reload): the page starts over with it.
      const newer = randomBytes(32).toString('base64url');
      await page.evaluate(`location.hash = ${js(`token=${newer}`)}, true`);
      await page.waitFor(
        `!!${buttonWith('Verify my email')} && !${buttonWith('Verify my email')}.disabled`,
      );
      check(
        (await page.evaluate('location.hash')) === '',
        'the new token is still in the address bar',
      );
      await context.close();
    },
  );

  await step(
    'reset password from the email: one request on a double click, then the password works',
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const before = (await newestMail(STUDENT.email))?.ID ?? null;
      await page.goto(`${BASE}/forgot-password`);
      await page.waitFor(`!!document.querySelector('button[type=submit]:not([disabled])')`);
      await typeInto(page, 'input[name=email]', STUDENT.email);
      await page.evaluate(`document.querySelector('button[type=submit]').click(), true`);
      await page.waitFor(hasText('If an account exists for this address'));
      const mail = await waitForNewMail(STUDENT.email, before);
      const match = `${mail.Text ?? ''} ${mail.HTML ?? ''}`.match(
        /\/reset-password#token=([A-Za-z0-9_-]{43})/,
      );
      check(match, 'no reset link in the email');
      const posts = [];
      page.onEvent('Network.requestWillBeSent', ({ request }) => {
        if (request.method === 'POST' && request.url.endsWith('/api/auth/reset-password'))
          posts.push(request.url);
      });
      await page.goto(`${BASE}/reset-password#token=${match[1]}`);
      await page.waitFor(`!!document.querySelector('button[type=submit]:not([disabled])')`);
      check((await page.evaluate('location.hash')) === '', 'the token is still in the address bar');
      await typeInto(page, 'input[name=password]', STUDENT.password);
      await typeInto(page, 'input[name=repeat]', STUDENT.password);
      await page.evaluate(
        `(() => { const b = document.querySelector('button[type=submit]'); b.click(); b.click(); return true; })()`,
      );
      await page.waitFor(hasText('Your password has been changed'));
      await sleep(500);
      check(posts.length === 1, `${posts.length} reset requests were sent`);
      await uiLogin(page, STUDENT, '/login', '/dashboard');
      await context.close();
    },
  );
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`e2e: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
