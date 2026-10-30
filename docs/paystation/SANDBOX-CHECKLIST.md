# PayStation sandbox checklist

Run each item against the PayStation **sandbox** with sandbox credentials (never live credentials outside production). Record the date, the exact request (credentials removed) and the response, then move the answer to `docs/DECISIONS.md` and close the matching row in `docs/OPEN-QUESTIONS.md` (P1–P7).

Official sources only: the merchant-dashboard Postman collection and the official docs PDF. `PAYSTATION-API.md` is superseded.

| # | Test | Expected / why it matters | Result |
|---|---|---|---|
| S1 | `initiate-payment` with an `invoice_number` of exactly 20 characters | Accepted; our generator never exceeds 20 | |
| S2 | `initiate-payment` with an `invoice_number` of 21 and 25 characters | Rejected, truncated, or accepted? (the Postman cURL example uses 23 characters; we cap at 20 either way) | |
| S3 | `initiate-payment` twice with the same `invoice_number` | Error code for a duplicate (RULEBOOK says 1008); we never reuse invoices | |
| S4 | Successful payment, then read every query parameter PayStation appends to `callback_url` | Callback parameter names and values (OPEN-QUESTIONS P1) | |
| S5 | Failed payment and cancelled payment: callback parameters | Values for failed/cancelled (P1) | |
| S6 | `transaction-status` for a paid, a failed, a cancelled and an abandoned (never paid) invoice | Response shape, status field values, amount format (P5) | |
| S7 | `transaction-status` for an unknown invoice | Error code/shape (P5) | |
| S8 | Is there a `/v2/transaction-status` (by trx id)? | P3 | |
| S9 | Does PayStation send any server-to-server notification (IPN) after a successful sandbox payment? | P2 | |
| S10 | With `pay_with_charge=1` (if supported): is the amount in the status response our amount or our amount plus the charge? | Our paid check compares amounts exactly (P6) | |
| S11 | Is the sandbox host the same as live (`api.paystation.com.bd`)? Do sandbox credentials fail against live and vice versa? | `PAYSTATION_ENV` and the live-credential guard (P4) | |
| S12 | How long does an unpaid checkout link stay valid? | Payment expiry setting (default 60 min) | |
| S13 | Close the tab mid-payment, then pay later or not at all | Reconciliation job must settle it; no double charge | |
| S14 | Refresh/replay the callback URL several times | Must be a no-op after the first settlement | |
