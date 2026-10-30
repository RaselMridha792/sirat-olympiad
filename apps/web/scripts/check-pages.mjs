// Render-level page checks against a running Next server. No dependencies beyond Node (and, for
// the prod mode, a locally installed Chrome or Edge used headless with a throwaway profile).
//
//   node scripts/check-pages.mjs leak [baseUrl]
//     Dev server only. ?mock=leak injects canary fields (scores, times, other people's emails,
//     answer keys) into every student-facing response. Each student page must still render and
//     its HTML (including the inline RSC payload) must contain none of them.
//
//   node scripts/check-pages.mjs prod [baseUrl]
//     Production server with no API connected. Every dashboard page must render the app shell and
//     a polite error or empty state in a real browser: never a blank page, never raw error text.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [mode, base = 'http://localhost:3100'] = process.argv.slice(2);

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

const STUDENT_ROUTES = [
  '/dashboard',
  '/dashboard/profile',
  '/dashboard/profile/edit',
  '/dashboard/exam',
  '/dashboard/leaderboard',
  '/dashboard/leaderboard?round=rd-1&page=2',
  '/dashboard/leaderboard?q=Padma',
  '/dashboard/announcements',
  '/dashboard/ambassador',
];
const ADMIN_ROUTES = [
  '/admin',
  '/admin/users',
  '/admin/ambassadors',
  '/admin/leaderboard',
  '/admin/exams',
  '/admin/exams/ex-r1-amb',
  '/admin/announcements',
];
const ERROR_TEXT = ['Something went wrong', 'কিছু একটা সমস্যা হয়েছে'];
const RAW_ERROR = [
  'DataSourceUnavailableError',
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

async function leakMode() {
  for (const route of STUDENT_ROUTES) {
    const url = base + withParam(route, 'mock', 'leak');
    const res = await fetch(url, { headers: { 'accept-language': 'en' } });
    const html = await res.text();
    // Visible markup only: the layout legitimately ships the translated error strings in its
    // inline RSC payload (for client error boundaries), so look outside <script> for those.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
    if (res.status !== 200) fail(route, `HTTP ${res.status}`);
    if (!visible.includes('<h1')) fail(route, 'no <h1> rendered');
    // <!--$!--> marks a Suspense boundary that errored on the server and fell back to the client.
    if (visible.includes('<!--$!-->') || ERROR_TEXT.some((t) => visible.includes(`>${t}<`))) {
      fail(route, 'rendered the error state');
    }
    // Canaries are searched in the WHOLE response: a leak into the RSC payload is still a leak.
    for (const needle of LEAK_NEEDLES)
      if (html.includes(needle)) fail(route, `leaked canary "${needle}"`);
    if (route.startsWith('/dashboard/leaderboard') && /@example\.(com|invalid)/.test(html)) {
      fail(route, 'an email address appears on the student leaderboard');
    }
  }
  return STUDENT_ROUTES.length;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

async function prodMode() {
  const browser = findBrowser();
  if (!browser) throw new Error('prod mode needs Chrome or Edge (set CHROME_PATH)');
  const profile = mkdtempSync(join(tmpdir(), 'sirat-check-'));
  try {
    for (const route of [...STUDENT_ROUTES, ...ADMIN_ROUTES]) {
      const res = await fetch(base + route);
      // 500 is fine (the data source failed and the error boundary rendered); 404/502 etc. are not.
      if (![200, 500].includes(res.status)) fail(route, `HTTP ${res.status}`);
      const dom = execFileSync(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--lang=en-US',
          `--user-data-dir=${profile}`,
          '--virtual-time-budget=15000',
          '--dump-dom',
          base + route,
        ],
        { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const text = dom
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      if (text.trim().length < 40) fail(route, 'blank page');
      if (!text.includes('Sirat')) fail(route, 'app shell (brand) missing');
      if (!ERROR_TEXT.some((t) => text.includes(t)))
        fail(route, 'no polite error/empty state shown');
      for (const raw of RAW_ERROR) {
        if (typeof raw === 'string' ? text.includes(raw) : raw.test(text))
          fail(route, `raw error text: ${raw}`);
      }
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  return STUDENT_ROUTES.length + ADMIN_ROUTES.length;
}

if (mode !== 'leak' && mode !== 'prod') {
  console.error('usage: node scripts/check-pages.mjs leak|prod [baseUrl]');
  process.exit(2);
}
const checked = mode === 'leak' ? await leakMode() : await prodMode();
if (failures.length) {
  console.error(`check-pages (${mode}): ${failures.length} problem(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-pages (${mode}): OK, ${checked} pages`);
