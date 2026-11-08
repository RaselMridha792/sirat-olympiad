# PayStation sandbox end-to-end on the VPS (2026-11-01)

**What this is:** the run that needs a real checkout in a browser and a public HTTPS server. It used Rasel's sandbox account on the VPS (`https://72-60-211-71.sslip.io`, release 8c5cea2, 4 API replicas), with Rasel at the browser, the lead running the VPS and payments watching read-only.

**Why on the production server:** a one-time pre-launch exception to PAYMENTS-PLAN D8 and §13.1 (Rasel's go, 2026-11-01). The production database is started again from an empty volume at the launch deploy, which the owner confirms then (RUNBOOK §9, pre-launch checklist). Sandbox account only, never the client's. No credential appears in this file, in a message or in a log.

The results are in `SANDBOX-CHECKLIST.md` (rows marked "VPS 2026-11-01") and summarised in section 3.

## 1. Setup

**The server:** SSH as the deploy user only. The clone is at `/srv/sirat`, the compose project is `sirat`, and `$DC` is as in RUNBOOK. Email goes to a private Mailpit.

**`.env` (Rasel typed the credentials; file mode 600):**

| Name | Value |
|---|---|
| `PAYSTATION_ENV` | `sandbox`. Allowed with `NODE_ENV=production`; only `live` requires production, and `fake` is refused there |
| `PAYSTATION_BASE_URL` | blank: the allow-list picks `https://sandbox.paystation.com.bd` |
| `PAYSTATION_MERCHANT_ID`, `PAYSTATION_PASSWORD` | Rasel's sandbox account; the id exactly as issued, with its "-" |
| `PAYSTATION_ACCOUNT_LABEL` | `rasel-sandbox-vps` |
| `PAYSTATION_INVOICE_PREFIX` | `TV` |
| `PAYSTATION_CALLBACK_URL` | `https://72-60-211-71.sslip.io/api/payments/paystation/callback` |
| `PAYSTATION_IPN_URL` | `https://72-60-211-71.sslip.io/api/payments/paystation/ipn` |
| `PAYSTATION_PAY_WITH_CHARGE` | `0` |

**Then:**
1. `$DC up -d --no-deps --no-build --wait api worker`. Compose recreates all 4 API replicas (`replicas: 4`): about 10–20 s without the API.
2. The boot lines: `$DC logs --since 5m api | grep "PayStation env="` showed one line per replica (4), each with `env=sandbox`, the sandbox host, `account=rasel-sandbox-vps`, `invoicePrefix=TV`, both URLs and `payWithCharge=0`.
3. `$DC run --rm --no-deps -T api node dist/cli/paystation-selfcheck.js` ended with `initiate: created`. It left one unpaid 10 BDT invoice, `X261101ET5FE5Y38J`, in the panel; it was never stored or paid.
4. Registration was opened in `/admin/settings` with a 2-hour window.

## 2. Test data

Every student was made up and clearly marked. Real students' data was never used.

| Name | Email | Phone |
|---|---|---|
| `TEST SBX 01` … `TEST SBX 12` | `sbx01@test.invalid` … `sbx12@test.invalid` | `01700000101` … `01700000112` |

- `@test.invalid` can never be delivered; every email went to the private Mailpit anyway.
- The phones follow the dev fixtures' pattern and are used once each. They go to PayStation's sandbox as `cust_phone`; no SMS is sent to them.
- Other fields: district `Dhaka`, institution `TEST Sandbox School`, any grade.
- Used: SBX 01, 03, 04 and 05. The rest are unused.
- Payments are marked by the label `rasel-sandbox-vps` and the `TV` invoice prefix.

## 3. Results

All times are Asia/Dhaka. "v1" is PayStation's transaction-status API, which alone decides paid or failed.

| Case | Student, invoice | What happened | Our side |
|---|---|---|---|
| P2 failure | SBX 01, `TV261101B8J6E7B63H` | bKash test wallet: "Payment Failed: Insufficient balance", then PayStation's "Redirecting to Merchant Website" | Callback 23:03:38 with `status=Failed&message=Failed`; v1 `failed` 0.3 s later, so `failed`; no account. Our page offered Try again and Start over |
| P1 success (via Try again) | SBX 01, `TV261101J13ZJ6CD44` | Our Try again made a new invoice for the same attempt (`POST /registrations/current/retry`); paid with the Mastercard test card | Callback 23:06:24 `status=Successful` with a `trx_id`; v1 `successful`, `"400.00"`, so `paid` at 23:06:25. One account; the verify email reached Mailpit at the same second |
| P3 cancel | SBX 03, `TV261101MNDHSDXZ9E` | Cancel on PayStation's checkout | Callback 23:09:53 with `status=Canceled` (no `message`, no `trx_id`); v1 stayed `processing`, so `pending`. Our page said "Waiting for your payment" with Continue the payment. The first reconciliation after the 10-minute limit (23:22:25) marked it `expired` |
| P4 tab closed, continued later | SBX 04, `TV261101G6F579DTDG` | The checkout tab was closed before paying; /register offered "Continue the payment" | `POST /registrations/current/resume` returned the same link (one initiate in total); paid by card; callback 23:14:46, v1 `successful`, so `paid`. One account |
| P5 callback replay | P1's invoice | The lead sent P1's success callback 3 more times with curl | Each answered 303; each was recorded with outcome `no_check_needed`; no verify job and no extra v1 call; still one account |
| P4b settle without a callback | SBX 05, `TV261101RSM71RYF6Z` | Meant to close the tab after paying, before PayStation's redirect; the redirect came first (34 s after the start) | Callback 23:18:07, v1 `successful`, so `paid`. One account. Settlement without a callback was therefore **not** tested |

**Also seen:**
- The 48-hour late watch re-checked the failed and the expired payment 92 times each; neither changed.
- Reconciliation runs came 3–6 minutes apart during the session.
- This card payment's `trx_id` was a 22-digit number; on 31 Oct a card payment had a 36-character UUID. Our column is free text, so both fit.
- No IPN arrived: Rasel's pre-KYC merchant panel has no IPN URL field (S29).

## 4. Still open

- **S9, S20 (the IPN):** not testable on a pre-KYC sandbox account. Check it after KYC, or on the client's account before launch (PAYMENTS-PLAN §13.4).
- **Settlement without a callback** (paid, then the browser never returns): untested. With no IPN on this account, only reconciliation can settle it. A rerun can block `*paystation/callback*` in Chrome DevTools (Network request blocking) before paying, so the redirect never reaches us. Then reconciliation alone must mark it paid with exactly one account.
- **S18 (PayStation's own retry on the same invoice):** not tried; our Try again makes a new invoice instead, which works.
- **S22 (what the checkout shows the payer):** not recorded.

## 5. Read-only checks

Every query is a SELECT, run through a read-only session (`default_transaction_read_only=on`, so a write fails). No query selects `payload` (raw gateway answers) or any student's email or phone.

The wrapper, on the VPS as the deploy user, reads SQL from stdin and takes psql variables, e.g. `RO_PSQL -v label=rasel-sandbox-vps < query.sql`:

```sh
RO_PSQL() { $DC exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
```

```sql
-- 1. The run's payments
SELECT invoice_number, status, gateway_status, trx_id IS NOT NULL AS has_trx,
       paid_amount_minor, check_count, review_reason, created_at, paid_at
FROM payments WHERE gateway_account = :'label' ORDER BY created_at;

-- 2. One payment's events, in order (initiate, callback, ipn, status_v1, admin)
SELECT source, outcome, status_code, trx_status, created_at
FROM payment_events WHERE invoice_number = :'invoice' ORDER BY created_at;

-- 3. IPN arrivals (S9, S20)
SELECT e.invoice_number, e.outcome, e.trx_status, e.created_at
FROM payment_events e JOIN payments p ON p.id = e.payment_id
WHERE e.source = 'ipn' AND p.gateway_account = :'label'
ORDER BY e.created_at;

-- 4. One account per paid payment, none for the others
SELECT p.invoice_number, p.status, r.id IS NOT NULL AS registered, u.name
FROM payments p
LEFT JOIN registrations r ON r.payment_id = p.id
LEFT JOIN users u ON u.id = r.user_id
WHERE p.gateway_account = :'label' ORDER BY p.created_at;

-- 5. The test students' attempts
SELECT name, status, completed_at FROM pending_registrations
WHERE name LIKE 'TEST SBX%' ORDER BY created_at;
```

**Logs during a run:** `$DC logs -f --tail=0 api worker nginx`, filtered for `paystation`, `payment` and `reconcil`.
- The API and worker lines carry no personal data by design.
- Nginx's access lines show each callback's path and status, but not its query string.
- The result page polls `GET /api/registrations/current` every 2–3 s while a payment is pending; filter those out.

## 6. Ending sandbox payments on the VPS

Payments stayed on in sandbox after the run, with registration open (the lead's setting; the VPS later moved to da934fc). To end them:
1. Close registration in `/admin/settings`.
2. Blank `PAYSTATION_ENV` and run `$DC up -d --no-deps --no-build --wait api worker`. The boot lines must then say `PayStation disabled` on every replica.
3. The test rows stay. They go when the production database is started again from an empty volume at the launch deploy, which the owner confirms then. Never delete them by hand: the foreign keys are RESTRICT, and the audit log is append-only.
