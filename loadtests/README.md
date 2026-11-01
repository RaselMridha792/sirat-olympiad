# Load tests (k6)

Run from ANOTHER machine, never from the VPS. Required before any real exam (rulebook sec. 13).
Scenarios to implement: `registration-surge.js`, `login-surge.js`, `exam-simulation.js` (1.5–2x expected peak,
including a first-hour surge). Pass: p95 < 500 ms, errors < 0.5%, no growing queue, CPU < 80%, zero lost submissions.

## `registration-surge.js` (payments, DoD #17)

Students register and pay as the browser would:
- the register page;
- `start` (the argon2 hash and the PayStation initiate run inside the request);
- the checkout;
- the callback, twice;
- the result page, polling until "completed".

Rules:
- Only against the **fake** PayStation (never load-test PayStation). `setup()` makes one start before any load, and its checkout must be the fake's page; otherwise the test stops there with "no load was sent". A misconfigured API (sandbox or live) gets that single initiate and nothing more. During the load, a checkout on any other host than setup's stops the test too.
- Never against production.
- Registration must already be open. The script opens nothing and needs no admin.

```bash
k6 run -e BASE_URL=http://127.0.0.1:4100 loadtests/registration-surge.js                # 4 starts/s for 5 min
k6 run -e BASE_URL=http://127.0.0.1:4100 -e RATE=8 -e HOLD=3m loadtests/registration-surge.js
```

Options:
- `RATE`: starts per second at the peak.
- `RAMP`, `HOLD`: how long to ramp up, and how long to hold the peak.
- `PAY_SHARE` (default 0.8): the share of students who pay.
- `PAY_DELAY` (default 3 s): the time on the checkout before paying.
- A start that answers 503 `SERVICE_BUSY` (a busy database) is sent once more, as the wizard does; `start_busy_retried` and `start_busy_after_retry` count them.
- `SPREAD_IPS` (default 1): one `X-Forwarded-For` address per student, for k6 talking to the API directly. Through nginx the generator's own address counts instead, and the start limit of 300/min per IP applies to it.

As a container for a load or staging stack: `infra/fake-paystation.compose.yml` (k6 inside the project, base URL `http://nginx`). Such a stack runs api and worker with `NODE_ENV=development` (logs pinned to info), because the API refuses the fake under `production`. Its numbers are therefore a development-mode API's: the VPS run with the real gateway path decides DoD #17. The setup is in `docs/RUNBOOK.md` §0; the local numbers are in `docs/DECISIONS.md` ("Registration surge, local k6").

## `exam-simulation.js` (exam engine, E6)

Students take the exam as the exam room does:
- log in, open the dashboard's exam list and the waiting room;
- start the attempt;
- answer locally and send a checkpoint every 60–120 s (the server refuses one sooner than 20 s after the last);
- submit with a client request id (sent again with the same id after no answer, a 429 or a 5xx, on the exam room's backoff of 2, 4, 8, 16 and 30 s), then open the waiting room, which must show the receipt.

A share of the students (`LEAVE_SHARE`, default 2 %) close the tab instead: the worker's sweep submits their last checkpoint once the time and the grace are over.

Scenarios (`SCENARIO`):
- `steady` (default): every student starts within `RAMP` seconds and works `MIN_WORK` (0.6) to 110 % of the exam time. Past 100 % means time up: the submit goes 0–20 s after the timer, inside the 30 s grace.
- `surge`: the window-open surge. Starts ramp to `RATE` per second within 60 s and stay there until every student has started.
- `timeup`: the time-up burst. Every student starts less than the exam time before the window ends, so every timer ends at `window_end` and all submits land within about 20 s.

Data: `apps/api/prisma/fixtures/loadtest-fixtures.ts` (the dev fixtures' four guards). `--users N` makes `load1..loadN@loadtest.invalid`, verified, each with a paid registration. `--exam` makes a new published exam per run (one attempt per student per exam). `--report <examId>` counts attempts, submissions and the database's writes. The password is `FIXTURE_PASSWORD`, hashed with the API's own argon2 parameters.

Pass:
- the k6 thresholds: p95 < 500 ms and errors < 0.5 % on the API, per endpoint too; checks > 99.5 %; every submit got a receipt and the waiting room shows it;
- zero lost submissions: every attempt k6 started is submitted and scored; the students' own submissions equal the receipts k6 received; the sweep submitted exactly the students who left;
- no growing queue: nothing left in progress or unscored once the sweep (every minute) has run;
- no database writes while the students only checkpoint (steady: between the last start and the first possible submit).

Locally, in its own compose project `sirat-exam-load` (`infra/docker-compose.yml` with `loadtests/exam-load.compose.yml`): the stack as on the server (PgBouncer, 2 API replicas, production mode) built from this checkout as `sirat-*:exam-load`, on throwaway settings; nothing is published. The fixtures run in a container that shares Postgres's network (the migrate image, with the clone's fixtures and `src` mounted read-only), so the host needs no node or pnpm. k6 runs in a container on the project's network and talks to the API replicas directly. A k6 container talking to an API on the Windows host lost new connections for 30 s at a time in Docker Desktop's host forwarding, which is why nothing here crosses it. Everything is removed at the end; nothing shared is touched.

```bash
bash loadtests/exam-local.sh                     # steady: 300 students, a 3-minute exam
USERS=500 RATE=10 bash loadtests/exam-local.sh surge
USERS=300 DURATION=3 bash loadtests/exam-local.sh timeup
```

It prints each check as `ok` or `FAIL` and keeps the logs, the k6 summary, the PC's CPU and each container's peak CPU in the folder it names. `KEEP_IMAGES=1` keeps the built images for the next run. The local numbers are in `docs/DECISIONS.md` ("Exam simulation, local k6").

**CI's smoke** (the docker job, after the stack's build):

```bash
SMOKE=1 NO_BUILD=1 LOAD_TAG=latest USERS=20 DURATION=1 RAMP=5 CHECKPOINT_MIN=21 CHECKPOINT_MAX=25 LEAVE_SHARE=0.15 \
  bash loadtests/exam-local.sh steady
```

- **Images:** the ones CI just built (`NO_BUILD`, never removed by the runner).
- **What it asserts:** only counted outcomes. The k6 limits are errors < 0.5 %, checks and every receipt shown in the room; the runner checks every attempt submitted and scored, the receipts equal to the students' own submissions, and the sweep's submissions equal to the students who left.
- **What it leaves out:** latency limits and the timed write window, since a shared CI runner's timing proves nothing.

## `login-surge.js` (RULEBOOK §13 scenario 2)

Students log in as the web does: `POST /api/auth/login` (the argon2 verify runs inside it), then `GET /api/auth/me` with the new session.

- **The load:** a constant arrival rate, `RATE` logins per second for `HOLD`, over the load students in turn.
- **Thresholds:** login and me p95 < 500 ms (not with `SMOKE=1`), errors < 0.5 %, checks, and no dropped iteration. A VU shortage would hide the load instead of measuring it.
- **What it measures:** argon2's cost on the cores it runs on, so the number that counts comes from the VPS. Run it at several rates to find the knee.

```bash
bash loadtests/exam-local.sh login                                    # this PC: 10, 20, 40, 60 logins/s, 60 s each
LOGIN_RATES="5 10" LOGIN_HOLD=30s bash loadtests/exam-local.sh login   # a quick proof of the script
```

The runner prints a table of each rate's login and me p95, errors, dropped iterations and the peak CPU per container. A rate past the knee only misses its thresholds; the run fails only if something breaks.

On the VPS, inside staging's network (no window, no root):

```bash
scripts/load-staging.sh up --users 2000
for r in 10 20 40 60; do scripts/load-staging.sh k6 login -e USERS=2000 -e RATE=$r -e HOLD=60s; done
scripts/load-staging.sh down
```

## On the VPS (`scripts/load-staging.sh`, RUNBOOK §19)

RULEBOOK §13: at 1.5–2× the expected peak, with a 30-minute exam, k6 from other machines. The target is a staging stack, `sirat-staging`, which `scripts/load-staging.sh` builds from the deployed release's images:
- its own volumes and throwaway settings, payments on the fake;
- never project `sirat`, never the production database or its secrets;
- nginx on port 8088, which the firewall drops from outside until a window opens it.

The exam simulation:

```bash
scripts/load-staging.sh up --users 8000                        # on the VPS, as deploy
scripts/load-staging.sh exam --duration 30 --window-end-in 60  # writes EXAM_ID into k6.env
scripts/load-staging.sh window --ips <gen1>,<gen2> --minutes 90   # as root, in the provider's console; Ctrl-C closes it
# on each generator machine, with k6.env copied over (it holds the throwaway load password), each with its own range:
set -a; . ./k6.env; set +a
k6 run -e IP_HEADER=cf-connecting-ip -e SCENARIO=surge -e RATE=10 -e FIRST=1 -e USERS=4000 loadtests/exam-simulation.js
k6 run -e IP_HEADER=cf-connecting-ip -e SCENARIO=surge -e RATE=10 -e FIRST=4001 -e USERS=4000 loadtests/exam-simulation.js
scripts/load-staging.sh report <examId>    # after the window and the grace: every attempt submitted and scored
scripts/load-staging.sh status              # as root: allow-list: closed
scripts/load-staging.sh down
```

- **The window** trusts the generators' `CF-Connecting-IP` (A2's `scripts/loadtest-generators.sh`), so each simulated student counts as its own address in nginx's limits. `--no-trusted` skips that; then each generator is a single address.
- **The run ends with the trusted generators off:** closing the window does it; without the window, `scripts/loadtest-generators.sh off`. The monitor alerts and `prelaunch-check.sh` fails while their file is left.
- **Zero lost submissions across generators:** add up the receipts in each generator's summary. That sum must equal the report's `submitted + time_up + violations`, and the students who left must equal `server_checkpoint + server_empty`.

The registration surge (payments' script) needs the fake's checkout, which only the stack's own network reaches:

```bash
scripts/load-staging.sh up --registration
scripts/load-staging.sh k6 registration -e RATE=4
scripts/load-staging.sh down
```
