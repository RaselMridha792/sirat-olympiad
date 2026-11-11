// Login surge (RULEBOOK §13 scenario 2; 02-SYSTEM-DESIGN: argon2id on login is the CPU risk). k6 only, no other
// dependency or remote import.
//
// One iteration is one student logging in as the web does: POST /api/auth/login (the argon2 verify runs inside it),
// then GET /api/auth/me with the new session (the dashboard's first read). A constant arrival rate: RATE logins per
// second for HOLD, so the summary shows what that rate costs. Run it at several rates to find the knee: the
// runners do (loadtests/exam-local.sh login locally, scripts/load-staging.sh k6 login on the VPS).
//
// Needs the load students of apps/api/prisma/fixtures/loadtest-fixtures.ts (the same secret: their participant IDs
// derive from it, load-id.js), the API. Never
// production.
//
//   PASSWORD=<fixture secret> k6 run -e BASE_URL=http://<api> -e USERS=300 -e RATE=20 loadtests/login-surge.js
//
// Options (-e): USERS (default 300) and FIRST (default 1): the students load<FIRST>..load<FIRST+USERS-1>, in turn;
// RATE (logins per second, default 10), HOLD (default 60s). SPREAD_IPS and IP_HEADER as in exam-simulation.js.
// SMOKE=1 drops the latency thresholds (counted outcomes only).
import { loadParticipantId } from './load-id.js';
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:4200').replace(/\/$/, '');
const PASSWORD = __ENV.PASSWORD || '';
const USERS = Number(__ENV.USERS || 300);
const FIRST = Number(__ENV.FIRST || 1);
const RATE = Number(__ENV.RATE || 10);
const HOLD = __ENV.HOLD || '60s';
const SPREAD_IPS = (__ENV.SPREAD_IPS ?? '1') === '1';
const IP_HEADER = (__ENV.IP_HEADER || 'x-forwarded-for').toLowerCase();
const SMOKE = __ENV.SMOKE === '1';

export const options = {
  scenarios: {
    logins: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: HOLD,
      preAllocatedVUs: Math.max(10, RATE * 2),
      maxVUs: Math.max(50, RATE * 20),
    },
  },
  thresholds: {
    // RULEBOOK §13: p95 < 500 ms (not in a smoke run) and errors < 0.5 %.
    ...(SMOKE
      ? {}
      : {
          'http_req_duration{name:login}': ['p(95)<500'],
          'http_req_duration{name:me}': ['p(95)<500'],
        }),
    'http_req_failed{kind:api}': ['rate<0.005'],
    checks: ['rate>0.995'],
    // Every planned login started: a VU shortage at a high rate would hide the load instead of measuring it.
    dropped_iterations: ['count==0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const throttled = new Counter('responses_429');

function ipFor(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/** The session cookies, kept here: they carry Secure in production, which k6's jar would not send over plain http. */
function cookiesOf(res) {
  const out = {};
  for (const [name, list] of Object.entries(res.cookies || {})) {
    const c = list[list.length - 1];
    if (c && (c.path || '/') !== '/api/auth/refresh') out[name] = c.value;
  }
  return out;
}

function login(n, headers) {
  return http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({
      email: `load${n}@loadtest.invalid`,
      participantId: loadParticipantId(PASSWORD, n),
    }),
    {
      jar: new http.CookieJar(),
      headers: { ...headers, 'content-type': 'application/json', 'x-requested-with': 'k6' },
      tags: { name: 'login', kind: 'api' },
    },
  );
}

export function setup() {
  if (!PASSWORD) exec.test.abort('PASSWORD is required (the load fixtures secret)');
  const res = login(FIRST, {});
  if (res.status !== 204)
    exec.test.abort(`load${FIRST}@loadtest.invalid cannot log in (${res.status})`);
}

export default function () {
  const n = FIRST + (exec.scenario.iterationInTest % USERS);
  const headers = SPREAD_IPS ? { [IP_HEADER]: ipFor(n) } : {};
  const res = login(n, headers);
  if (res.status === 429) throttled.add(1, { name: 'login' });
  if (!check(res, { 'login 204': (r) => r.status === 204 })) return;
  const me = http.get(`${BASE}/api/auth/me`, {
    jar: new http.CookieJar(),
    cookies: cookiesOf(res),
    headers,
    tags: { name: 'me', kind: 'api' },
  });
  if (me.status === 429) throttled.add(1, { name: 'me' });
  check(me, {
    'me 200, the same student': (r) =>
      r.status === 200 && r.json('email') === `load${n}@loadtest.invalid`,
  });
}
