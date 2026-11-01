// Exam simulation (EXAM-PLAN 6.2, E6; RULEBOOK §13 scenario 3). k6 only, no other dependency or remote import.
//
// One iteration is one student, as the exam room would do it:
//   1. POST /api/auth/login, then the dashboard's GET /api/exams and the waiting room's GET /api/exams/:id.
//   2. POST /api/exams/:id/attempts: the attempt and its questions.
//   3. Answers locally; PUT /api/attempts/:id/checkpoint every CHECKPOINT_MIN..CHECKPOINT_MAX seconds (the server
//      refuses one sooner than 20 s after the last).
//   4. POST /api/attempts/:id/submit with a client request id (sent again with the same id after no answer, a 429 or
//      a 5xx, on the exam room's backoff), then the waiting room again, which must show the receipt.
//   LEAVE_SHARE of the students close the tab instead of submitting: the worker's sweep submits their last checkpoint
//   once the time and the grace are over (server_checkpoint).
//
// Scenarios (SCENARIO, default steady):
//   steady  every student starts within RAMP seconds, works MIN_WORK..110 % of the exam time, then submits; those
//           whose time runs out submit `time_up` 0-20 s after it (inside the 30 s grace).
//   surge   the window-open surge: starts ramp to RATE per second within 60 s and stay there until USERS started.
//   timeup  the time-up burst: every student starts less than the exam time before the window ends, so every timer
//           ends at window_end, and all submits land within about 20 s of it.
//
// Needs: the load students and a published exam from apps/api/prisma/fixtures/loadtest-fixtures.ts (the same password),
// the API and its worker. Never production. The local run: loadtests/exam-local.sh (README).
//
//   PASSWORD=<fixture password> k6 run -e BASE_URL=http://<api> -e EXAM_ID=<id> -e USERS=300 loadtests/exam-simulation.js
//
// Options (-e): USERS (default 300) and FIRST (default 1): students load<FIRST>..load<FIRST+USERS-1>. RAMP (steady,
// default 30 s), RATE (surge, starts per second, default 10), CHECKPOINT_MIN/CHECKPOINT_MAX (default 60/120 s),
// MIN_WORK (default 0.6), LEAVE_SHARE (default 0.02), MAX_DURATION (default 45m). SPREAD_IPS=1 (default) sends one
// client address per student in IP_HEADER: X-Forwarded-For (the default) for k6 talking to the API directly (the API
// trusts one proxy hop); CF-Connecting-IP through nginx, which takes it only from a trusted generator
// (scripts/loadtest-generators.sh, LAUNCH-PLAN L14); otherwise the generator's own address counts.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:4200').replace(/\/$/, '');
const EXAM_ID = __ENV.EXAM_ID || '';
const PASSWORD = __ENV.PASSWORD || '';
const SCENARIO = __ENV.SCENARIO || 'steady';
const USERS = Number(__ENV.USERS || 300);
const FIRST = Number(__ENV.FIRST || 1);
const RAMP = Number(__ENV.RAMP || 30);
const RATE = Number(__ENV.RATE || 10);
const CHECKPOINT_MIN = Math.max(21, Number(__ENV.CHECKPOINT_MIN || 60));
const CHECKPOINT_MAX = Math.max(CHECKPOINT_MIN, Number(__ENV.CHECKPOINT_MAX || 120));
const MIN_WORK = Number(__ENV.MIN_WORK ?? 0.6);
const LEAVE_SHARE = Number(__ENV.LEAVE_SHARE ?? 0.02);
const SPREAD_IPS = (__ENV.SPREAD_IPS ?? '1') === '1';
const IP_HEADER = (__ENV.IP_HEADER || 'x-forwarded-for').toLowerCase();
const MAX_DURATION = __ENV.MAX_DURATION || '45m';
/** Inside the exam's 30 s grace: a late submit is still the student's own. */
const LATE_SUBMIT_MAX = 20;

const scenarios = {
  steady: {
    executor: 'per-vu-iterations',
    vus: USERS,
    iterations: 1,
    maxDuration: MAX_DURATION,
  },
  surge: {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: USERS,
    maxVUs: USERS,
    stages: [
      { target: RATE, duration: '60s' },
      // After the ramp (about RATE * 30 starts), the rest at RATE per second.
      { target: RATE, duration: `${Math.max(1, Math.ceil((USERS - RATE * 30) / RATE))}s` },
    ],
    gracefulStop: MAX_DURATION,
  },
  timeup: {
    executor: 'per-vu-iterations',
    vus: USERS,
    iterations: 1,
    maxDuration: MAX_DURATION,
  },
};
if (!scenarios[SCENARIO])
  throw new Error(`SCENARIO must be steady, surge or timeup (got ${SCENARIO})`);

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: {
    // RULEBOOK §13: p95 < 500 ms and errors < 0.5 % on the API.
    'http_req_duration{kind:api}': ['p(95)<500'],
    'http_req_failed{kind:api}': ['rate<0.005'],
    // Per endpoint, so the summary shows each one.
    'http_req_duration{name:login}': ['p(95)<500'],
    'http_req_duration{name:exams}': ['p(95)<500'],
    'http_req_duration{name:room}': ['p(95)<500'],
    'http_req_duration{name:start}': ['p(95)<500'],
    'http_req_duration{name:checkpoint}': ['p(95)<500'],
    'http_req_duration{name:submit}': ['p(95)<500'],
    checks: ['rate>0.995'],
    // Zero lost submissions: every student who submitted got a receipt, and the waiting room shows it.
    submit_receipt: ['rate==1'],
    receipt_in_room: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const receipts = new Counter('receipts');
const receiptRate = new Rate('submit_receipt');
const receiptInRoom = new Rate('receipt_in_room');
const left = new Counter('students_left');
const started = new Counter('attempts_started');
const throttled = new Counter('responses_429');
const tooSoon = new Counter('checkpoint_too_soon');
const submitRetries = new Counter('submit_retries');
/** The exam room's submit backoff (apps/web/src/components/exam/exam-controller.ts), in seconds. */
const SUBMIT_BACKOFF = [2, 4, 8, 16, 30];

const api = (name, extra = {}) => ({ tags: { name, kind: 'api' }, ...extra });

function uuid() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    const v =
      i === 12 ? 4 : i === 16 ? 8 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 16);
    out += hex[v];
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

function ipFor(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

const between = (lo, hi) => lo + Math.random() * (hi - lo);

/** One student's browser: its own cookies and address, and the session renewal after a 401 (the web does it). */
function browser(n) {
  // The session cookies are kept here, not in k6's jar: they carry Secure in production, and the jar would not send
  // them over plain http (a local run). Each one goes only under its own path, as a browser sends it.
  const cookies = {};
  const remember = (res) => {
    for (const [name, list] of Object.entries(res.cookies || {})) {
      const c = list[list.length - 1];
      if (c) cookies[name] = { value: c.value, path: c.path || '/' };
    }
  };
  const forPath = (path) => {
    const out = {};
    for (const [name, c] of Object.entries(cookies))
      if (path.startsWith(c.path)) out[name] = c.value;
    return out;
  };
  const headers = SPREAD_IPS ? { [IP_HEADER]: ipFor(n) } : {};
  const write = { ...headers, 'content-type': 'application/json', 'x-requested-with': 'k6' };
  const send = (method, path, body, name) => {
    const params = api(name, {
      jar: new http.CookieJar(), // empty: only the cookies below are sent
      cookies: forPath(path),
      headers: body === null && method === 'GET' ? headers : write,
    });
    const res = http.request(method, `${BASE}${path}`, body, params);
    if (res.status === 429) throttled.add(1, { name });
    remember(res);
    return res;
  };
  const call = (method, path, body, name) => {
    const res = send(method, path, body, name);
    if (res.status !== 401 || name === 'login') return res;
    const renewed = send('POST', '/api/auth/refresh', null, 'refresh');
    return renewed.status === 204 ? send(method, path, body, name) : res;
  };
  return { call };
}

function login(b, n) {
  const res = b.call(
    'POST',
    '/api/auth/login',
    JSON.stringify({ email: `load${n}@loadtest.invalid`, password: PASSWORD }),
    'login',
  );
  return check(res, { 'login 204': (r) => r.status === 204 });
}

export function setup() {
  if (!EXAM_ID || !PASSWORD)
    exec.test.abort('EXAM_ID and PASSWORD are required (loadtests/README.md)');
  const b = browser(FIRST);
  if (!login(b, FIRST))
    exec.test.abort(`load${FIRST}@loadtest.invalid cannot log in (run the load fixtures)`);
  const room = b.call('GET', `/api/exams/${EXAM_ID}`, null, 'room');
  if (room.status !== 200) exec.test.abort(`GET /api/exams/${EXAM_ID} answered ${room.status}`);
  const exam = room.json();
  if (exam.attempt)
    exec.test.abort('the exam already has attempts: create a new one per run (--exam)');
  return {
    windowEnd: Date.parse(exam.windowEnd),
    durationSeconds: exam.durationMinutes * 60,
    graceSeconds: exam.graceSeconds,
  };
}

/** The student's local answers: a share of the questions by now, as a real student answers on the way. */
function answersAt(count, share, previous) {
  const want = Math.min(count, Math.round(count * share));
  const answers = previous.slice();
  for (let i = 0; i < want; i += 1)
    if (answers[i] === null) answers[i] = Math.floor(Math.random() * 4);
  return answers;
}

function takeExam(n, data, startAtMs) {
  const b = browser(n);
  if (startAtMs !== null) sleep(Math.max(0, (startAtMs - Date.now()) / 1000));
  if (!login(b, n)) return;
  b.call('GET', '/api/exams', null, 'exams');
  const room = b.call('GET', `/api/exams/${EXAM_ID}`, null, 'room');
  check(room, { 'room 200': (r) => r.status === 200 });

  const start = b.call('POST', `/api/exams/${EXAM_ID}/attempts`, null, 'start');
  if (!check(start, { 'start 201': (r) => r.status === 201 })) return;
  started.add(1);
  const view = start.json();
  const count = view.questions.length;
  const t0 = Date.now();
  const endsAt = t0 + view.remainingSeconds * 1000;
  const total = Math.max(1, endsAt - t0);
  // The time-up burst: everyone runs out of time. Otherwise MIN_WORK..110 % of the time, past 100 % = time up.
  const wantEnd = SCENARIO === 'timeup' ? Infinity : t0 + total * between(MIN_WORK, 1.1);
  const leaves = Math.random() < LEAVE_SHARE;

  let answers = Array(count).fill(null);
  let seq = 0;
  let nextCheckpoint = t0 + between(CHECKPOINT_MIN, CHECKPOINT_MAX) * 1000;
  for (;;) {
    const stopAt = Math.min(wantEnd, endsAt);
    if (nextCheckpoint >= stopAt) {
      sleep(Math.max(0, (stopAt - Date.now()) / 1000));
      break;
    }
    sleep(Math.max(0, (nextCheckpoint - Date.now()) / 1000));
    answers = answersAt(count, (Date.now() - t0) / total, answers);
    seq += 1;
    const body = JSON.stringify({ seq, answers, violationCount: 0, events: [] });
    const cp = b.call('PUT', `/api/attempts/${view.attemptId}/checkpoint`, body, 'checkpoint');
    if (cp.status === 429) tooSoon.add(1);
    check(cp, { 'checkpoint 200': (r) => r.status === 200 });
    nextCheckpoint = Date.now() + between(CHECKPOINT_MIN, CHECKPOINT_MAX) * 1000;
  }

  if (leaves) {
    // Closes the tab: the sweep submits the last checkpoint after the time and the grace.
    left.add(1);
    return;
  }
  const timeUp = Date.now() >= endsAt - 500;
  if (timeUp) sleep(Math.random() * LATE_SUBMIT_MAX);
  answers = answersAt(count, timeUp ? 1 : (Date.now() - t0) / total, answers);
  const submitBody = JSON.stringify({
    requestId: uuid(),
    answers,
    endReason: timeUp ? 'time_up' : 'submitted',
    violationCount: 0,
    events: [],
  });
  const path = `/api/attempts/${view.attemptId}/submit`;
  // As the exam room: no answer, a 429 or a 5xx is sent again after 2, 4, 8, 16 and 30 s, with the same request id
  // (the same receipt). Past the grace the server refuses for good, and the sweep submits the last checkpoint.
  let sub = b.call('POST', path, submitBody, 'submit');
  for (const wait of SUBMIT_BACKOFF) {
    if (sub.status !== 0 && sub.status !== 429 && sub.status < 500) break;
    submitRetries.add(1);
    sleep(wait);
    sub = b.call('POST', path, submitBody, 'submit');
  }
  const ok = check(sub, {
    'submit 200 with a receipt': (r) => r.status === 200 && !!r.json('receiptId'),
  });
  receiptRate.add(ok);
  if (!ok) return;
  receipts.add(1);
  const after = b.call('GET', `/api/exams/${EXAM_ID}`, null, 'room');
  receiptInRoom.add(
    after.status === 200 && after.json('attempt.receipt.receiptId') === sub.json('receiptId'),
  );
}

export default function (data) {
  if (SCENARIO === 'surge') {
    const i = exec.scenario.iterationInTest;
    if (i >= USERS) return; // every student has started
    takeExam(FIRST + i, data, null);
    return;
  }
  const i = exec.vu.idInTest - 1;
  if (SCENARIO === 'steady') {
    takeExam(FIRST + i, data, Date.now() + Math.random() * RAMP * 1000);
    return;
  }
  // timeup: start between 60 s and the exam time (at most 5 min) before the window ends.
  const lead = between(60, Math.max(61, Math.min(data.durationSeconds, 300)));
  takeExam(FIRST + i, data, data.windowEnd - lead * 1000);
}
