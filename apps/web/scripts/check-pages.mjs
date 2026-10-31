// Render-level page checks against a running Next server, with real sessions from the API (no session stub).
// No dependencies beyond Node and, for the prod mode, a locally installed Chrome or Edge (scripts/lib/cdp.mjs).
// Run with --experimental-strip-types (the package scripts do): it reads the access table from src/lib/access.ts.
//
//   node scripts/check-pages.mjs leak [baseUrl]
//     Dev server only. ?mock=leak injects canary fields (scores, times, other people's emails,
//     answer keys) into every student-facing response. Each student page must still render and
//     its HTML (including the inline RSC payload) must contain none of them.
//
//   node scripts/check-pages.mjs prod [baseUrl]
//     Production server whose data source is not connected yet. Every dashboard page must render the app shell,
//     a heading and its polite error state (or, for a page that reads no data, its content) in a real browser:
//     never a blank page, never raw error text. The public pages (PUBLIC_ROUTES: the entry page and the legal pages,
//     English and Bangla) must answer 200 without any cookie and render their content the same way.
//
//   node scripts/check-pages.mjs api-down [baseUrl]
//     Production server whose API is stopped or unreachable. A dashboard page with a session cookie must show the
//     polite error page and stay on its URL: a busy or broken API must never send a whole hall to /login.
//
// Sessions: log in through the API (CHECK_API_URL, default http://localhost:4000) as CHECK_STUDENT_EMAIL /
// CHECK_STUDENT_PASSWORD (a fixture student) and, for the admin pages, CHECK_ADMIN_EMAIL / CHECK_ADMIN_PASSWORD
// (an admin made with the create-admin CLI). Each page is checked with the role that may open it and must end on
// the URL that was asked for; a page the role may not open must answer as src/lib/access.ts says (the other
// area: a redirect home; a restricted page: not found). Without any cookie, a page must go to /refresh.
//
// Routes are discovered from src/app (every page.tsx under /dashboard and /admin), so a new screen
// is checked without editing this file; a new dynamic segment needs a sample value in SAMPLE.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGES, publicPath } from '../src/content/site.ts';
import { decideAccess } from '../src/lib/access.ts';
import { apiLogin, launchBrowser } from './lib/cdp.mjs';

const [mode, base = 'http://localhost:3100'] = process.argv.slice(2);
const API = process.env.CHECK_API_URL ?? 'http://localhost:4000';

// Same values as src/data/mock/leak.ts (change both together).
const CANARY = {
  text: 'LEAK_CANARY_7Q9Z',
  score: 98765431,
  seconds: 87654319,
  email: 'leak.canary',
};

const bnDigits = (s) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
const numberForms = (n) => {
  const forms = [
    String(n),
    new Intl.NumberFormat('en-GB').format(n),
    new Intl.NumberFormat('bn-BD').format(n),
  ];
  return [...new Set([...forms, bnDigits(String(n))])];
};
const LEAK_NEEDLES = [
  CANARY.text,
  CANARY.email,
  ...numberForms(CANARY.score),
  ...numberForms(CANARY.seconds),
  ...numberForms(Math.floor(CANARY.seconds / 60)), // formatDuration's minutes part
];

// Sample values for dynamic segments (ids that exist in the dev mock), by route path.
const SAMPLE = { 'admin/exams/[id]': 'ex-r1-amb', 'dashboard/exam/[id]': 'ex-r1-amb' };

/** Every page as { url, route }: `route` keeps the [segment] (the access table's key), `url` has the sample. */
function discoverRoutes(dir, parts = [], routeParts = []) {
  const routes = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (/^\(.+\)$/.test(name))
        routes.push(...discoverRoutes(path, parts, routeParts)); // route group
      else if (/^\[.+\]$/.test(name)) {
        const sample = SAMPLE[[...parts, name].join('/')];
        if (!sample)
          throw new Error(`check-pages: add a SAMPLE value for ${[...parts, name].join('/')}`);
        routes.push(...discoverRoutes(path, [...parts, sample], [...routeParts, name]));
      } else routes.push(...discoverRoutes(path, [...parts, name], [...routeParts, name]));
    } else if (name === 'page.tsx')
      routes.push({ url: '/' + parts.join('/'), route: '/' + routeParts.join('/') });
  }
  return routes;
}

const ROUTES = discoverRoutes(fileURLToPath(new URL('../src/app/', import.meta.url)));
const under = (prefix) =>
  ROUTES.filter(({ url }) => url === prefix || url.startsWith(prefix + '/'));
const STUDENT_ROUTES = under('/dashboard');
if (STUDENT_ROUTES.some(({ url }) => url === '/dashboard/leaderboard')) {
  for (const url of ['/dashboard/leaderboard?round=rd-1&page=2', '/dashboard/leaderboard?q=Padma'])
    STUDENT_ROUTES.push({ url, route: '/dashboard/leaderboard' });
}
const ADMIN_ROUTES = under('/admin');
const ERROR_TEXT = ['Something went wrong', 'কিছু একটা সমস্যা হয়েছে'];
const NOT_FOUND_TITLE = 'Page not found'; // common.notFound.title (the browser runs with --lang=en-US)
const RAW_ERROR = [
  'DataSourceUnavailableError',
  'ServerApiError',
  'not connected yet',
  'Application error',
  'Unhandled Runtime Error',
  'SIRAT_MOCK_DATA_SOURCE',
  /\n\s+at [\w.<>]+ \(/,
];

const withParam = (route, key, value) =>
  `${route}${route.includes('?') ? '&' : '?'}${key}=${value}`;
const failures = [];
const fail = (route, why) => failures.push(`${route}: ${why}`);

function credentials(role) {
  const email = process.env[`CHECK_${role.toUpperCase()}_EMAIL`];
  const password = process.env[`CHECK_${role.toUpperCase()}_PASSWORD`];
  if (!email || !password)
    throw new Error(`check-pages: set CHECK_${role.toUpperCase()}_EMAIL and _PASSWORD`);
  return { email, password };
}

async function sessionFor(role) {
  const { email, password } = credentials(role);
  return (await apiLogin(API, email, password)).sirat_access;
}

/** Without any cookie, a dashboard page answers 307 to /refresh?next=<that page>. */
async function checkNoSession() {
  for (const url of ['/dashboard/profile', '/admin/users?page=2']) {
    const res = await fetch(base + url, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    const expected = `/refresh?next=${encodeURIComponent(url)}`;
    if (res.status !== 307 || !location.endsWith(expected))
      fail(url, `without a session: want 307 to ${expected}, got ${res.status} ${location}`);
  }
}

async function leakMode() {
  await checkNoSession();
  const cookie = `sirat_access=${await sessionFor('student')}`;
  let checked = 0;
  for (const { url, route } of STUDENT_ROUTES) {
    const decision = decideAccess(route, 'student');
    const res = await fetch(base + withParam(url, 'mock', 'leak'), {
      headers: { 'accept-language': 'en', cookie },
      redirect: 'manual',
    });
    const html = await res.text();
    // Canaries are searched in the WHOLE response: a leak into the RSC payload is still a leak.
    for (const needle of LEAK_NEEDLES)
      if (html.includes(needle)) fail(url, `leaked canary "${needle}"`);
    if (decision.kind === 'not-found') {
      // Under a loading.tsx the answer is already streaming (HTTP 200) when the page calls notFound(), so the
      // proof is the not-found page itself, not the status.
      if (![200, 404].includes(res.status) || !html.includes(NOT_FOUND_TITLE))
        fail(url, `a student must get the not-found page here (HTTP ${res.status})`);
      continue;
    }
    checked += 1;
    // Visible markup only: the layout legitimately ships the translated error strings in its
    // inline RSC payload (for client error boundaries), so look outside <script> for those.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
    if (res.status !== 200) fail(url, `HTTP ${res.status} ${res.headers.get('location') ?? ''}`);
    if (!visible.includes('<h1')) fail(url, 'no <h1> rendered');
    // <!--$!--> marks a Suspense boundary that errored on the server and fell back to the client.
    if (visible.includes('<!--$!-->') || ERROR_TEXT.some((t) => visible.includes(`>${t}<`))) {
      fail(url, 'rendered the error state');
    }
    if (url.startsWith('/dashboard/leaderboard') && /@example\.(com|invalid)/.test(html)) {
      fail(url, 'an email address appears on the student leaderboard');
    }
  }
  return checked;
}

/** The visible text and markup of a settled page. */
async function render(page, url) {
  await page.goto(base + url);
  await page.settle();
  const dom = await page.html();
  const markup = dom.replace(/<script[\s\S]*?<\/script>/g, ' ');
  const text = markup
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const final = new URL(await page.url());
  return { markup, text, final: final.pathname + final.search };
}

function checkRendered(url, { markup, text }) {
  if (text.trim().length < 40) fail(url, 'blank page');
  if (!text.includes('Sirat')) fail(url, 'app shell (brand) missing');
  // The error state renders its title as the page's h1, so every healthy page has one.
  if (!/<h1[\s>]/.test(markup)) fail(url, 'no heading: neither content nor a polite error');
  for (const raw of RAW_ERROR) {
    if (typeof raw === 'string' ? text.includes(raw) : raw.test(text))
      fail(url, `raw error text: ${raw}`);
  }
}

/** The public pages in both languages (content/site.ts): static, no cookie needed. */
const PUBLIC_ROUTES = PUBLIC_PAGES.flatMap((page) => [
  publicPath(page, 'en'),
  publicPath(page, 'bn'),
]);

async function prodMode() {
  await checkNoSession();
  const browser = await launchBrowser();
  let errorStates = 0;
  let checked = 0;
  try {
    const visitor = await browser.newContext();
    const anonymous = await visitor.newPage();
    for (const url of PUBLIC_ROUTES) {
      const res = await fetch(base + url, { redirect: 'manual' });
      if (res.status !== 200)
        fail(url, `public page: want 200 without a session, got ${res.status}`);
      const shown = await render(anonymous, url);
      checkRendered(url, shown);
      if (shown.final !== url) fail(url, `public page ended on ${shown.final}`);
      if (ERROR_TEXT.some((t) => shown.text.includes(t)))
        fail(url, 'public page shows the error state');
      checked += 1;
    }
    await visitor.close();
    for (const [role, routes, otherArea] of [
      ['student', STUDENT_ROUTES, '/admin'],
      ['admin', ADMIN_ROUTES, '/dashboard'],
    ]) {
      const context = await browser.newContext();
      const token = await sessionFor(role);
      await context.setCookie(base, 'sirat_access', token);
      const page = await context.newPage();
      for (const { url, route } of [...routes, { url: otherArea, route: otherArea }]) {
        const decision = decideAccess(route, role);
        const res = await fetch(base + url, {
          headers: { cookie: `sirat_access=${token}`, 'accept-language': 'en' },
          redirect: 'manual',
        });
        const shown = await render(page, url);
        checkRendered(url, shown);
        if (decision.kind === 'redirect') {
          if (shown.final !== decision.to)
            fail(url, `${role}: want ${decision.to}, ended on ${shown.final}`);
          continue;
        }
        if (decision.kind === 'not-found') {
          // Streamed under a loading.tsx: the status may already be 200; the page shown is the proof.
          if (!shown.text.includes(NOT_FOUND_TITLE)) fail(url, `${role}: want the not-found page`);
          if (shown.final !== url)
            fail(url, `${role}: not found should stay on ${url}, ended on ${shown.final}`);
          continue;
        }
        checked += 1;
        // 500 is fine (the data source failed and the error boundary rendered); 404/502 etc. are not.
        if (![200, 500].includes(res.status)) fail(url, `HTTP ${res.status}`);
        if (shown.final !== url)
          fail(url, `${role}: ended on ${shown.final}, not on the page asked for`);
        if (ERROR_TEXT.some((t) => shown.text.includes(t))) errorStates += 1;
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`check-pages (prod): ${errorStates} page(s) showed the polite error state`);
  console.log(
    'check-pages (prod): ambassador, manager and jury sessions are not in this run; their pages are covered by src/lib/access.test.ts',
  );
  return checked;
}

/** The API is down: any cookie gets past the proxy, the session lookup fails, the error page shows. */
async function apiDownMode() {
  const browser = await launchBrowser();
  let checked = 0;
  try {
    const context = await browser.newContext();
    await context.setCookie(base, 'sirat_access', 'api-down-check');
    const page = await context.newPage();
    for (const url of ['/dashboard', '/dashboard/profile', '/admin']) {
      const shown = await render(page, url);
      if (shown.final !== url)
        fail(url, `API down: ended on ${shown.final}, want the error page on ${url}`);
      if (!ERROR_TEXT.some((t) => shown.text.includes(t)))
        fail(url, 'API down: no polite error page');
      for (const raw of RAW_ERROR) {
        if (typeof raw === 'string' ? shown.text.includes(raw) : raw.test(shown.text))
          fail(url, `raw error text: ${raw}`);
      }
      checked += 1;
    }
  } finally {
    await browser.close();
  }
  return checked;
}

const MODES = { leak: leakMode, prod: prodMode, 'api-down': apiDownMode };
if (!Object.hasOwn(MODES, mode)) {
  console.error('usage: node scripts/check-pages.mjs leak|prod|api-down [baseUrl]');
  process.exit(2);
}
const checked = await MODES[mode]();
if (failures.length) {
  console.error(`check-pages (${mode}): ${failures.length} problem(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-pages (${mode}): OK, ${checked} pages`);
