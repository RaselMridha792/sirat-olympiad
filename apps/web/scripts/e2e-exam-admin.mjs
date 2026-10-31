// Browser end-to-end test of exam authoring (E5b) against the whole stack behind nginx (APP_URL), with the shared CDP
// driver. An admin, in the browser: the settings form (its own checks first, then a draft), questions through the
// dialog (its checks, add, edit in place, delete), publish (refused with the reason, then done), a published edit
// that becomes version 2, an unpublish the server refuses, the settings of a published exam (frozen fields, a later
// close with a reason), a change made elsewhere refused as stale, and an archive. The settings page must carry no
// question or answer key.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... pnpm --filter @sirat/web e2e:exam-admin [baseUrl]
//
// The local stack is shared: say so before running this (RUNBOOK §0). It leaves one published exam
// ("E2E authoring <time>", open for about 90 minutes) and one archived draft behind. Loopback URLs only.
import { randomBytes } from 'node:crypto';
import { apiLogin, cspReport, launchBrowser } from './lib/cdp.mjs';
import { isLoopbackUrl } from './lib/local-only.mjs';

const BASE = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:8080';
if (!isLoopbackUrl(BASE)) {
  console.error('e2e-exam-admin: the base URL is not on this machine; nothing was sent');
  process.exit(2);
}
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? '',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};
if (!ADMIN.email || !ADMIN.password) {
  console.error('e2e-exam-admin: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
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

const cookieHeader = (cookies) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

/** Setup and checks through the API with the admin's cookies. */
async function adminApi(cookies, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      cookie: cookieHeader(cookies),
      'content-type': 'application/json',
      'x-requested-with': 'sirat-web',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Bangladesh wall-clock time for a datetime-local input, `minutes` from now (whole minutes). */
const dhaka = (minutes) =>
  new Date(Math.floor(Date.now() / 60_000) * 60_000 + minutes * 60_000 + 6 * 3_600_000)
    .toISOString()
    .slice(0, 16);
const dhakaToIso = (local) => new Date(Date.parse(`${local}:00+06:00`)).toISOString();

const CANARY = `AUTHORING-CANARY-${randomBytes(6).toString('hex')}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const browser = await launchBrowser();
let examId = null;
try {
  console.log(`e2e-exam-admin against ${BASE}`);
  const cookies = await apiLogin(BASE, ADMIN.email, ADMIN.password);
  const context = await browser.newContext();
  for (const [name, value] of Object.entries(cookies)) await context.setCookie(BASE, name, value);
  const page = await context.newPage();

  // Writes the browser sends to the exam admin API, by method and path.
  const writes = [];
  page.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (request.url.startsWith(`${BASE}/api/admin/exams`) && request.method !== 'GET')
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
  });

  const text = (t) => `!!document.body && document.body.innerText.includes(${js(t)})`;
  const noText = (t) => `!!document.body && !document.body.innerText.includes(${js(t)})`;
  // Exact labels ("Publish" must not find "Publish results" or "Unpublish"), and never a button of a closed dialog:
  // the results panel keeps its confirm dialog, with its own "Publish", in the page.
  const button = (t, scope = 'document') =>
    `[...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${js(t)} && !b.closest('dialog:not([open])'))`;
  const inDialog = (t) => button(t, `(document.querySelector('dialog[open]') ?? document)`);
  const click = (selector) =>
    page.evaluate(
      `(() => { const el = ${selector}; if (!el || el.disabled) return false; el.click(); return true; })()`,
    );
  async function clickWhenReady(selector) {
    await page.waitFor(`(() => { const el = ${selector}; return !!el && !el.disabled; })()`);
    check(await click(selector), `click ${selector.slice(0, 60)}`);
  }
  /** Sets a React-controlled field the way typing does (the native setter, then the event React listens to). */
  const fill = (selector, value) =>
    page.evaluate(`(() => {
      const el = ${selector};
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      return true;
    })()`);
  const byId = (id) => `document.getElementById(${js(id)})`;
  async function fillForm(values) {
    for (const [id, value] of Object.entries(values))
      check(await fill(byId(id), value), `field ${id}`);
  }
  const dialogClosed = `!document.querySelector('dialog[open]')`;
  /** Fills the open question dialog: text, option texts (the default four), the correct one. */
  async function fillQuestion(questionText, options, correct) {
    await page.waitFor(`!!document.querySelector('dialog[open] textarea')`);
    check(
      await fill(`document.querySelector('dialog[open] textarea')`, questionText),
      'question text',
    );
    for (const [i, option] of options.entries())
      check(
        await fill(
          `document.querySelectorAll('dialog[open] input[type=text], dialog[open] input:not([type])')[${i}]`,
          option,
        ),
        `option ${i}`,
      );
    if (correct !== null)
      check(
        await click(`document.querySelectorAll('dialog[open] input[type=radio]')[${correct}]`),
        'correct',
      );
  }
  const examPage = () => `${BASE}/admin/exams/${examId}`;

  await step('the exam list offers "New exam", which opens the settings form', async () => {
    await page.goto(`${BASE}/admin/exams`);
    await clickWhenReady(`document.querySelector('a[href="/admin/exams/new"]')`);
    await page.waitFor(`location.pathname === '/admin/exams/new' && !!${byId('exam-title')}`);
  });

  await step('an empty form shows what to fix and sends nothing', async () => {
    await clickWhenReady(button('Create the draft'));
    await page.waitFor(text('Please fix the fields marked below.'));
    check(await page.evaluate(text('Required.')), 'a field says Required');
    check(writes.length === 0, `sent ${writes.join(', ')}`);
  });

  await step('a window shorter than one attempt is caught by the form', async () => {
    await fillForm({
      'exam-title': `E2E authoring ${new Date().toISOString()}`,
      'exam-window-start': dhaka(-2),
      'exam-window-end': dhaka(3),
      'exam-duration': '10',
      'exam-questions': '2',
      'exam-grace': '30',
    });
    await clickWhenReady(button('Create the draft'));
    await page.waitFor(text('The window must be at least one attempt long'));
    check(writes.length === 0, `sent ${writes.join(', ')}`);
  });

  await step('the draft is created and its page opens', async () => {
    await fillForm({ 'exam-window-end': dhaka(60) });
    await clickWhenReady(button('Create the draft'));
    await page.waitFor(`/^\\/admin\\/exams\\/[0-9a-f-]{36}$/.test(location.pathname)`);
    examId = (await page.evaluate('location.pathname')).match(UUID)?.[0] ?? null;
    check(examId, 'the exam id');
    await page.waitFor(text('Draft'));
    check(writes.includes('POST /api/admin/exams'), `writes: ${writes.join(', ')}`);
  });
  if (!examId) throw new Error('no exam to author');

  await step(
    'the question dialog refuses duplicate options and a missing correct choice',
    async () => {
      await clickWhenReady(button('Add question'));
      await fillQuestion(
        'A question with two equal options',
        ['Same', ' same ', 'Other', 'Last'],
        null,
      );
      const before = writes.length;
      await clickWhenReady(inDialog('Save'));
      await page.waitFor(text('The same as another option.'));
      check(await page.evaluate(text('Mark the correct option.')), 'mark the correct option');
      check(writes.length === before, 'nothing was sent');
      await clickWhenReady(inDialog('Cancel'));
      await page.waitFor(dialogClosed);
    },
  );

  await step('three questions are added through the dialog', async () => {
    for (const n of [1, 2, 3]) {
      await clickWhenReady(button('Add question'));
      await fillQuestion(
        `E2E authoring question ${n} ${CANARY}`,
        [`Alpha ${n}`, `Beta ${n}`, `Gamma ${n}`, `Delta ${n}`],
        n % 4,
      );
      await clickWhenReady(inDialog('Save'));
      await page.waitFor(dialogClosed);
      await page.waitFor(text(`E2E authoring question ${n}`));
    }
    await page.waitFor(text('Questions (3)'));
  });

  await step('publishing 3 questions for 2 per attempt is refused, with the reason', async () => {
    await clickWhenReady(button('Publish'));
    await clickWhenReady(inDialog('Publish'));
    await page.waitFor(text('The number of active questions does not match'));
    await page.waitFor(text('Draft'));
  });

  await step('a draft question is deleted', async () => {
    await clickWhenReady(`document.querySelector('button[aria-label="Delete question 3"]')`);
    await clickWhenReady(inDialog('Delete'));
    await page.waitFor(text('Questions (2)'));
    await page.waitFor(noText('E2E authoring question 3'));
  });

  await step('a draft question is edited in place (no new version)', async () => {
    await clickWhenReady(`document.querySelector('button[aria-label="Edit question 1"]')`);
    await page.waitFor(`!!document.querySelector('dialog[open] textarea')`);
    check(await page.evaluate(noText('Save as version')), 'a draft edit makes no version');
    check(
      await fill(
        `document.querySelector('dialog[open] textarea')`,
        `E2E authoring question 1 edited ${CANARY}`,
      ),
      'text',
    );
    await clickWhenReady(inDialog('Save'));
    await page.waitFor(dialogClosed);
    await page.waitFor(text('E2E authoring question 1 edited'));
    const exam = await adminApi(cookies, 'GET', `/admin/exams/${examId}`);
    check(exam.questions[0].version === 1, `version ${exam.questions[0].version}`);
  });

  await step('the exam is published', async () => {
    await clickWhenReady(button('Publish'));
    await clickWhenReady(inDialog('Publish'));
    await page.waitFor(`${text('Published')} && !(${button('Publish')})`);
    check(await page.evaluate(`!!(${button('Unpublish')})`), 'Unpublish is offered');
    check(await page.evaluate(`!(${button('Add question')})`), 'no adding to a fixed set');
  });

  await step('a published edit says it makes version 2, and does', async () => {
    await clickWhenReady(`document.querySelector('button[aria-label="Edit question 2"]')`);
    await page.waitFor(text('saving makes version 2'));
    check(
      await fill(
        `document.querySelector('dialog[open] textarea')`,
        `E2E authoring question 2 v2 ${CANARY}`,
      ),
      'text',
    );
    await clickWhenReady(inDialog('Save as version 2'));
    await page.waitFor(dialogClosed);
    await page.waitFor(text('E2E authoring question 2 v2'));
    const exam = await adminApi(cookies, 'GET', `/admin/exams/${examId}`);
    check(
      exam.questions.some((q) => q.version === 2 && q.text.includes('v2')),
      'version 2 is active',
    );
    check(exam.questions.length === 2, `${exam.questions.length} active questions`);
  });

  await step('unpublishing after the window opened is refused, with the reason', async () => {
    await clickWhenReady(button('Unpublish'));
    await clickWhenReady(inDialog('Unpublish'));
    await page.waitFor(text('it can no longer be unpublished'));
  });

  await step('the settings page carries no question or answer key', async () => {
    const res = await fetch(`${examPage()}/edit`, { headers: { cookie: cookieHeader(cookies) } });
    const html = await res.text();
    check(res.status === 200, `status ${res.status}`);
    check(!html.includes(CANARY), 'a question text reached the settings page');
    check(
      !/correctKey|"correct"|Alpha 1|Beta 2/.test(html),
      'an option or key reached the settings page',
    );
  });

  await step(
    'a published exam: frozen fields read-only; a later close needs a reason, then saves',
    async () => {
      await page.goto(`${examPage()}/edit`);
      await page.waitFor(`!!${byId('exam-title')}`);
      check(await page.evaluate(`${byId('exam-duration')}.disabled`), 'the duration is frozen');
      check(await page.evaluate(`${byId('exam-window-start')}.disabled`), 'the start is frozen');
      check(await page.evaluate(`!${byId('exam-title')}.disabled`), 'the title stays editable');
      await page.waitFor(text('Fixed once the exam is published.'), { timeout: 5_000 });
      const later = dhaka(90);
      await fillForm({ 'exam-window-end': later });
      await page.waitFor(`!!${byId('exam-reason')}`);
      await clickWhenReady(button('Save changes'));
      await page.waitFor(text('Give a reason of 3 to 200 characters.'));
      await fillForm({ 'exam-reason': 'E2E: the window is extended' });
      await clickWhenReady(button('Save changes'));
      await page.waitFor(`location.pathname === ${js(`/admin/exams/${examId}`)}`);
      const exam = await adminApi(cookies, 'GET', `/admin/exams/${examId}`);
      check(
        exam.windowEnd === dhakaToIso(later),
        `windowEnd ${exam.windowEnd}, want ${dhakaToIso(later)}`,
      );
      check(exam.durationMinutes === 10, 'the duration is unchanged');
    },
  );

  await step(
    'a change made elsewhere since the form opened is refused as stale, not overwritten',
    async () => {
      await page.goto(`${examPage()}/edit`);
      await page.waitFor(`!!${byId('exam-title')}`);
      const fresh = await adminApi(cookies, 'GET', `/admin/exams/${examId}`);
      const elsewhere = `${fresh.title} (renamed elsewhere)`;
      await adminApi(cookies, 'PATCH', `/admin/exams/${examId}`, {
        expectedUpdatedAt: fresh.updatedAt,
        title: elsewhere,
      });
      await fillForm({ 'exam-title': `${fresh.title} (from the stale form)` });
      await clickWhenReady(button('Save changes'));
      await page.waitFor(text('Someone changed this exam since you opened it'));
      const after = await adminApi(cookies, 'GET', `/admin/exams/${examId}`);
      check(after.title === elsewhere, `title ${after.title}`);
    },
  );

  await step('a draft is archived; an archive offers no edits', async () => {
    const draft = await adminApi(cookies, 'POST', '/admin/exams', {
      title: `E2E authoring archive ${new Date().toISOString()}`,
      category: null,
      roundId: null,
      windowStart: new Date(Date.now() + 86_400_000).toISOString(),
      windowEnd: new Date(Date.now() + 90_000_000).toISOString(),
      durationMinutes: 10,
      questionsPerAttempt: 1,
      graceSeconds: 30,
      randomDraw: false,
    });
    await page.goto(`${BASE}/admin/exams/${draft.id}`);
    await clickWhenReady(button('Archive'));
    await clickWhenReady(inDialog('Archive'));
    await page.waitFor(`${text('Archived')} && !document.querySelector('a[href$="/edit"]')`);
    check(
      await page.evaluate(`!(${button('Publish')}) && !(${button('Add question')})`),
      'no actions left',
    );
  });

  await context.close();
} finally {
  await browser.close();
}

const csp = cspReport(browser, BASE); // LAUNCH-PLAN §3: the page CSP is delivered and never broken
results.push(csp.ok);
console.log(csp.line);

const failed = results.filter((ok) => !ok).length;
console.log(
  failed
    ? `e2e-exam-admin: ${failed} of ${results.length} failed`
    : `e2e-exam-admin: all ${results.length} passed`,
);
process.exit(failed ? 1 : 0);
