# PayStation sandbox end-to-end: the IPN run

**Status: draft.** The venue waits for the owner's answer:
- **(A) the VPS:** `https://72-60-211-71.sslip.io`, a one-time pre-launch exception to PAYMENTS-PLAN D8 and §13.1. The production database is started again from an empty volume at the launch deploy, which the owner confirms then.
- **(B) the PAYMENTS-PLAN §8.1 tunnel:** this worktree's own API and worker, reached through a temporary tunnel.

Section 1 (the venue's setup) is written once the answer is in. Everything else applies to both venues.

Nothing runs until the lead gives the turn and Rasel is at the browser. Sandbox account only, never the client's. No credential appears in this file, in a message or in a log.

## 1. Setup (the venue)

_Written after the owner's answer._

## 2. Test data

Every student of the run is made up and clearly marked. Real students' data is never used.

| # | Name | Email | Phone |
|---|---|---|---|
| 01–12 | `TEST SBX 01` … `TEST SBX 12` | Rasel's own address with a `+sbx01` … `+sbx12` tag (he fills in the address) | `01700000101` … `01700000112` |

- **Phones:** one agreed list, each used once (phones are unique per open attempt and per user). They follow the dev fixtures' pattern (`01700000001`…), so they read as test numbers. They are sent to PayStation's sandbox as `cust_phone` and may show on its checkout (S22). No SMS is ever sent to them. Rasel may swap in numbers he controls; the list then changes here first.
- **Other fields:** district `Dhaka`, institution `TEST Sandbox School`, any grade.
- **Payments:** marked by the account label and invoice prefix of the venue (section 1). Every SQL below filters on the label.

## 3. What the run answers

These rows of `SANDBOX-CHECKLIST.md` need PayStation to reach our server, or a browser on a real checkout:

| Row | Question | How it shows |
|---|---|---|
| S9 | Does the sandbox send an IPN after a successful payment at all? | A `payment_events` row with `source = 'ipn'` (SQL 3), and nginx's access log line |
| S20 | IPN content type, timing against the callback, retries | The event's time against the callback's; P6 below for retries |
| S29 | Where is the IPN URL registered for a test account; is more than one allowed? | The panel (section 4) |
| S30 | Must the callback domain be whitelisted? | The first start: initiate answers `"200"`, or an error naming the domain |
| S5, S16 | Cancel on the checkout: is the browser sent back, with which method and parameters? | P3 below; nginx's log line of the callback |
| S13, S27 | Close the tab, reopen the link, pay later | P4 below |
| S14 | Replaying the callback changes nothing | P5 below |
| S18 | After a failed try, can the same invoice still succeed? | P2 below |

Each result goes into its checklist row with the date, then into DECISIONS where it changes a rule.

## 4. The panel (Rasel)

1. **S29:** find where the sandbox account takes an IPN URL, if it has one at all. Register the venue's `PAYSTATION_IPN_URL`, and write down whether a second URL could be added.
2. **S30:** look for a callback-domain whitelist. Add nothing unless the first start is refused.
3. **After the run:** remove the IPN URL again, so this account never points at a server afterwards (PAYMENTS-PLAN §13.1 rule 5).

## 5. The payments

Each payment uses a new student from section 2. The expected outcome in our system is listed with each.

| | Steps | Expected |
|---|---|---|
| P1 success | Register, pay with a sandbox test card | Callback → our result page → `paid`. One account; its email in Mailpit; login and the dashboard work. An IPN event too (S9) |
| P2 failure, then retry | Pay with a method that fails (bKash with no balance, or a declined card); then, if the checkout offers it, try again on the same invoice | Callback `status=Failed` → `failed` after verify; no account. S18: whether the same invoice can still succeed |
| P3 cancel | Cancel on the checkout | S5/S16 recorded. Ours stays `pending` until expiry (10 min), then `expired`, then the 48 h late watch |
| P4 late payment | Start, close the tab, reopen the link later, pay | Only the IPN and the reconciliation can settle it: ends `paid` with exactly one account |
| P5 callback replay | Reload P1's callback URL a few times | A redirect each time; no new event that changes anything; still one account |
| P6 IPN retry (S20) | Turn the maintenance switch on just before paying; turn it off after about 2 minutes | The IPN meets 503 at first. PayStation's retry count and interval show in nginx's log; the payment ends `paid` either way |

## 6. Read-only checks

Every query is a SELECT, run through a read-only session: `default_transaction_read_only=on`, so a write fails. The venue's wrapper `RO_PSQL` is set in section 1. It reads SQL from stdin and takes `-v label=… -v invoice=…`.

No query selects `payload` (raw gateway answers) or any student's email or phone.

```sql
-- 1. The run's payments
SELECT invoice_number, status, gateway_status, trx_id IS NOT NULL AS has_trx,
       paid_amount_minor, check_count, review_reason, created_at, paid_at
FROM payments WHERE gateway_account = :'label' ORDER BY created_at;

-- 2. One payment's events, in order (initiate, callback, ipn, status_v1, admin)
SELECT source, outcome, status_code, trx_status, created_at
FROM payment_events WHERE invoice_number = :'invoice' ORDER BY created_at;

-- 3. IPN arrivals in the last 3 hours (S9, S20)
SELECT e.invoice_number, e.outcome, e.trx_status, e.created_at
FROM payment_events e JOIN payments p ON p.id = e.payment_id
WHERE e.source = 'ipn' AND p.gateway_account = :'label' AND e.created_at > now() - interval '3 hours'
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

-- 6. Payments audit rows of the run
SELECT action, count(*) FROM audit_logs
WHERE created_at > now() - interval '3 hours'
  AND (action LIKE 'payments.%' OR action = 'registration.completed' OR action = 'settings.changed')
GROUP BY action ORDER BY action;
```

**Logs during the run:** the API and worker lines about `paystation`, payments, the IPN and verify. Payment logs carry no personal data by design. Nginx's access lines for `/api/payments/paystation/` show each callback and IPN: its status and source address. PayStation's IPN address is worth writing down.

## 7. After the run

1. Close registration in `/admin/settings`.
2. Turn payments off (`PAYSTATION_ENV` blank), restart `api` and `worker`, and check the boot line again: it must say `PayStation disabled`.
3. Remove the IPN URL from the panel (section 4).
4. Write each S-row's result into `SANDBOX-CHECKLIST.md` with the date, including the name of `paystation:selfcheck`'s unpaid `X…` invoice if the venue ran it.
5. The test rows stay as they are. Removing them is the owner's decision, made at the venue's cleanup step, never by hand (foreign keys are RESTRICT, and the audit log is append-only).
