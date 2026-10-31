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
- `SPREAD_IPS` (default 1): one `X-Forwarded-For` address per student, for k6 talking to the API directly. Through nginx the generator's own address counts instead, and the start limit of 300/min per IP applies to it.

The setup is in `docs/RUNBOOK.md` §0; the local numbers are in `docs/DECISIONS.md` ("Registration surge, local k6").
