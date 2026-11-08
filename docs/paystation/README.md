# docs/paystation/

Committed:
* `PAYSTATION-NOTES.md` — credential-free summary of the official PayStation docs. **Start here.**
* `SANDBOX-CHECKLIST.md` — checks to run in the PayStation sandbox.
* `SANDBOX-E2E.md` — the sandbox run that needs PayStation to reach us (the IPN): test data, payments, read-only checks.
* `PAYSTATION-API.md` — SUPERSEDED (built from an outdated public-page summary; kept for history).

Local only, git-ignored (they contain PayStation's shared sandbox credentials):
* `paystation.pdf` — the official documentation page, printed 2026-10-30.
* the merchant-dashboard Postman collection (`*.json`; a redacted copy may be committed as `*.redacted.json`).

Never put into a committed file here: merchantId, password, tokens, or any credential.
