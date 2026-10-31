// Browser end-to-end test of the exam room against the whole stack behind nginx (docker compose, APP_URL), with the
// shared CDP driver. An admin creates and publishes a short exam (all categories, through the API); a fixture student
// takes it in the browser: rules, an answer, a warning, a reload (the answer and the count survive), then warnings
// up to the 6th violation, which submits (owner Q4). Every response the student's browser receives, its HTML and its
// localStorage are then searched: no correct answer, explanation, score or question id may ever reach it.
//
//   E2E_STUDENT_PASSWORD=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... [E2E_STUDENT_EMAIL=student1@fixtures.invalid]
//   pnpm --filter @sirat/web e2e:exam [baseUrl]
//
// The local stack is shared: say so before running this (RUNBOOK §0). It leaves one published exam behind
// ("E2E exam <time>", a 15-minute window; an exam is archived only after its results are published). Loopback
// URLs only.
import { randomBytes } from 'node:crypto';
import { apiLogin, cspReport, launchBrowser } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';

const BASE = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080';
if (!isLoopbackUrl(BASE)) {
  console.error('e2e-exam: the base URL is not on this machine; nothing was sent');
  process.exit(2);
}
const STUDENT = {
  email: process.env.E2E_STUDENT_EMAIL ?? 'student1@fixtures.invalid',
  password: process.env.E2E_STUDENT_PASSWORD ?? '',
};
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? '',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};
if (!STUDENT.password || !ADMIN.email || !ADMIN.password) {
  console.error('e2e-exam: set E2E_STUDENT_PASSWORD, E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  process.exit(2);
}

const js = JSON.stringify;
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

/** The admin side, through the API with the admin's cookies. */
async function adminApi(cookies, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      'content-type': 'application/json',
      'x-requested-with': 'sirat-web',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

const CANARY = `EXPLAIN-CANARY-${randomBytes(6).toString('hex')}`;
/** JSON keys the student's API answers must never have. */
const FORBIDDEN_KEYS = new Set([
  'correctKey',
  'correct',
  'correctAnswer',
  'correct_answer',
  'correct_key',
  'isCorrect',
  'explanation',
  'score',
  'rank',
  'points',
  'questionId',
  'question_id',
  'optionKeys',
]);
function forbiddenKeys(value, path = '$', found = []) {
  if (Array.isArray(value)) value.forEach((v, i) => forbiddenKeys(v, `${path}[${i}]`, found));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) found.push(`${path}.${k}`);
      forbiddenKeys(v, `${path}.${k}`, found);
    }
  return found;
}

const browser = await launchBrowser();
let exam = null;
let admin = null;
const questionIds = [];
try {
  console.log(`e2e-exam against ${BASE}`);

  await step('admin creates and publishes a 15-minute exam for all categories', async () => {
    admin = await apiLogin(BASE, ADMIN.email, ADMIN.password);
    const now = Date.now();
    exam = await adminApi(admin, 'POST', '/admin/exams', {
      title: `E2E exam ${new Date(now).toISOString()}`,
      category: null,
      roundId: null,
      windowStart: new Date(now - 60_000).toISOString(),
      windowEnd: new Date(now + 15 * 60_000).toISOString(),
      durationMinutes: 10,
      questionsPerAttempt: 3,
      graceSeconds: 30,
      randomDraw: false,
    });
    for (let i = 1; i <= 3; i++) {
      const q = await adminApi(admin, 'POST', `/admin/exams/${exam.id}/questions`, {
        text: `E2E question ${i}: which letter comes ${['first', 'second', 'third'][i - 1]}?`,
        options: ['A', 'B', 'C', 'D'].map((key) => ({ key, text: `Letter ${key} (${i})` })),
        correctKey: ['A', 'B', 'C'][i - 1],
        explanation: `${CANARY} ${i}`,
      });
      questionIds.push(q.id, q.lineageId);
    }
    const fresh = await adminApi(admin, 'GET', `/admin/exams/${exam.id}`);
    exam = await adminApi(admin, 'POST', `/admin/exams/${exam.id}/publish`, {
      expectedUpdatedAt: fresh.updatedAt,
    });
    check(exam.status === 'published', `status ${exam.status}`);
    check(questionIds.every(Boolean), 'question ids');
  });
  if (!exam?.id || exam.status !== 'published') throw new Error('no exam to take');

  const context = await browser.newContext();
  for (const [name, value] of Object.entries(await apiLogin(BASE, STUDENT.email, STUDENT.password)))
    await context.setCookie(BASE, name, value);
  const page = await context.newPage();
  // A headless page never loses focus by itself: only the events below count.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // Every response the student's browser gets from the app, by URL.
  const bodies = [];
  const urls = new Map();
  page.onEvent('Network.responseReceived', ({ requestId, response }) => {
    if (response.url.startsWith(BASE)) urls.set(requestId, response.url);
  });
  page.onEvent('Network.loadingFinished', ({ requestId }) => {
    const url = urls.get(requestId);
    if (!url) return;
    page
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) =>
        bodies.push({ url, body: base64Encoded ? Buffer.from(body, 'base64').toString() : body }),
      )
      .catch(() => {});
  });

  const room = `/dashboard/exam/${exam.id}`;
  const text = (t) => `!!document.body && document.body.innerText.includes(${js(t)})`;
  const click = (selector) =>
    page.evaluate(
      `(() => { const el = ${selector}; if (!el) return false; el.click(); return true; })()`,
    );
  const button = (t) =>
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${js(t)}))`;
  const fire = (code) => page.evaluate(`(${code}, true)`);
  const leave = () => fire(`window.dispatchEvent(new Event('blur'))`);
  const back = () => fire(`window.dispatchEvent(new Event('focus'))`);
  const devtools = () => fire(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12' }))`);
  const stored = () =>
    page.evaluate(
      `JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('sirat.exam.v1.')).map((k) => [k, localStorage.getItem(k)]))`,
    );
  async function warning(n) {
    await page.waitFor(text(`Warning ${n}/5`), { timeout: 10_000 });
    check(await click(button('Return to exam')), 'Return to exam');
    await page.waitFor(`!document.querySelector('dialog[open]')`, { timeout: 5_000 });
  }

  await step('the exam list links to the exam room', async () => {
    await page.goto(BASE + '/dashboard/exam');
    await page.waitFor(`!!document.querySelector('a[href=${js(room)}]')`);
  });

  await step(
    'rules, then the player: the questions arrive, an answer is saved in the browser',
    async () => {
      await page.goto(BASE + room);
      await page.waitFor(
        `(() => { const b = ${button('Start the exam')}; return b && !b.disabled; })()`,
      );
      await click(button('Start the exam'));
      await page.waitFor(text('Do Not Disturb'));
      check(
        await page.evaluate(`!!(${button('Start now')})?.disabled`),
        'Start now waits for the checkbox',
      );
      await click(`document.querySelector('dialog[open] input[type=checkbox]')`);
      await click(button('Start now'));
      await page.waitFor(`document.querySelectorAll('[role=radio]').length === 4`, {
        timeout: 15_000,
      });
      await click(`document.querySelectorAll('[role=radio]')[2]`);
      await page.waitFor(
        `document.querySelectorAll('[role=radio]')[2].getAttribute('aria-checked') === 'true'`,
      );
      const saved = JSON.parse(await stored());
      check(saved.length === 1, `one local copy, got ${saved.length}`);
      check(JSON.parse(saved[0][1]).answers[0] === 2, 'the answer is the option position');
    },
  );

  await step(
    'leaving the page is warning 1/5; a reload keeps the answer and the count',
    async () => {
      await leave();
      await warning(1);
      await back();
      await page.goto(BASE + room);
      await page.waitFor(text('Warnings 1/5'), { timeout: 15_000 });
      await click(`document.querySelector('nav ol button')`);
      await page.waitFor(
        `document.querySelectorAll('[role=radio]')[2]?.getAttribute('aria-checked') === 'true'`,
      );
    },
  );

  await step(
    'warnings 2-5 (leave and F12), then the 6th violation submits the current answers',
    async () => {
      await devtools();
      await warning(2);
      for (const n of [3, 4]) {
        await leave();
        await warning(n);
        await back();
      }
      await devtools();
      await warning(5);
      await leave();
      await page.waitFor(text('Submitted automatically after the last warning.'), {
        timeout: 30_000,
      });
      check((await stored()) === '[]', 'the local copy is gone after the receipt');
      const detail = await page.evaluate(
        `fetch('/api/exams/${exam.id}', { credentials: 'same-origin' }).then((r) => r.json())`,
      );
      check(detail.attempt?.phase === 'submitted', `phase ${detail.attempt?.phase}`);
      check(
        detail.attempt?.receipt?.endReason === 'violations',
        `end reason ${detail.attempt?.receipt?.endReason}`,
      );
    },
  );

  await step('no answer key, explanation, score or question id reached the browser', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500)); // the last response bodies
    bodies.push({ url: 'final HTML', body: await page.html() });
    bodies.push({
      url: 'localStorage',
      body: await page.evaluate(`JSON.stringify({ ...localStorage })`),
    });
    const problems = [];
    for (const { url, body } of bodies) {
      if (body.includes(CANARY)) problems.push(`${url}: the explanation`);
      for (const id of questionIds) if (body.includes(id)) problems.push(`${url}: a question id`);
      if (url.includes('/api/')) {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* not JSON */
        }
        for (const key of forbiddenKeys(json)) problems.push(`${url}: ${key}`);
      }
    }
    check(
      bodies.some((b) => b.url.includes(`/api/exams/${exam.id}/attempts`)),
      'the start answer was captured',
    );
    check(problems.length === 0, problems.slice(0, 5).join('; '));
    console.log(`        (${bodies.length} responses searched)`);
  });

  await context.close();
} finally {
  await browser.close();
}

const csp = cspReport(browser); // LAUNCH-PLAN §3: the page CSP is delivered and never broken
results.push(csp.ok);
console.log(csp.line);

const failed = results.filter((ok) => !ok).length;
console.log(
  failed
    ? `e2e-exam: ${failed} of ${results.length} failed`
    : `e2e-exam: all ${results.length} passed`,
);
process.exit(failed ? 1 : 0);
