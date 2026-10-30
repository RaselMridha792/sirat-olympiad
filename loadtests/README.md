# Load tests (k6)

Run from ANOTHER machine, never from the VPS. Required before any real exam (rulebook sec. 13).
Scenarios to implement: `registration-surge.js`, `login-surge.js`, `exam-simulation.js` (1.5–2x expected peak,
including a first-hour surge). Pass: p95 < 500 ms, errors < 0.5%, no growing queue, CPU < 80%, zero lost submissions.
