# PayStation sandbox checklist

Run each item against the PayStation **sandbox** with sandbox credentials (never live credentials outside production). Record the date, the exact request (credentials removed) and the response, then move the answer to `docs/DECISIONS.md` and close the matching row in `docs/OPEN-QUESTIONS.md` (P1–P7).

Read `PAYSTATION-NOTES.md` first (the official docs, summarised). `PAYSTATION-API.md` is superseded.

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
| S10 | With `pay_with_charge=0` (owner, 2026-10-31: the merchant bears the charge): does the checkout show the student exactly the fee, and is v1 `payment_amount` of a **paid** payment exactly the fee? | Paid only when `payment_amount` equals the fee (P6) | **Half done 2026-10-31.** A 400 BDT checkout (`T261031Y6SQCJXZ01`, `pay_with_charge=0`) shows "Pay BDT 400.00", with no charge added; unpaid, v1 says `processing`, `"400.00"`. **Still open:** pay with the sandbox test card. The checkout is a JavaScript page (M-Banking / Cards / Net-Banking, then OTP), so it needs Rasel at a browser. Then read v1 `payment_amount` |
| S11 | Is the sandbox host the same as live (`api.paystation.com.bd`)? Do sandbox credentials fail against live and vice versa? | `PAYSTATION_ENV` and the live-credential guard (P4) | **Done 2026-10-31** (Rasel's sandbox account; one `initiate-payment` of 10 BDT per case with an `XS11…` invoice, never paid; then v1 status).<br>- **`https://sandbox.paystation.com.bd` works**, with the merchant id **exactly as issued, including its "-"**: initiate `"200"` "Payment Link Created Successfully.", `payment_url` on `sandbox.paystation.com.bd`; v1 `"200"` "Transaction found", `trx_status` `processing`, `payment_amount` `"10.00"`.<br>- The same id **without the "-"** (as in the docs' curl example): initiate `"1001"` "Invalid Credential.", v1 `"2001"`.<br>- **Sandbox credentials on `api.paystation.com.bd`** (the host the docs' URL text shows), with and without the "-": initiate `"1001"`, v1 `"2001"`.<br>- So sandbox and live are separate hosts, and the allow-list in `payment.config.ts` stays as it is. The Postman form/header value with the "-" is right; the curl example and the URL text are wrong. |
| S12 | How long does an unpaid checkout link stay valid? | Payment expiry setting (default 60 min) | |
| S13 | Close the tab mid-payment, then pay later or not at all | Reconciliation job must settle it; no double charge | |
| S14 | Refresh/replay the callback URL several times | Must be a no-op after the first settlement | |
| S15 | Exact `trx_status` strings from v1 **and** v2 for paid, failed, refunded and in-progress payments (case and spelling: `success`, `Success`, `successful`?) | Update the accepted list (owner: lowercased `success`/`successful` = paid; anything else is neither paid nor failed) | |
| S16 | Cancel on the checkout page, and a failed payment: is the browser sent back to `callback_url` at all, with which HTTP method and which parameters? | OPEN-QUESTIONS P1 | |
| S17 | `2001` for an unknown invoice vs for a wrong `merchantId`: same code and message? | `2001` is never treated as failed; alert when it repeats | **Partly seen 2026-10-31 (S11 runs):** with a wrong merchant id, or on the wrong host, v1 answered `"2001"` "Transaction not found in system", the same text as for an invoice that does not exist there. They cannot be told apart, as expected. A wrong credential on **initiate** answers `"1001"` "Invalid Credential.", a code the docs do not list. |
| S18 | After a failed try on the checkout, can the student try again on the **same** invoice and then succeed? | Whether `failed` is final (plan 5: re-checked until expiry plus the late watch) | |
| S19 | Does v1 echo our `reference`? | The cross-check in `decide()` (a different echoed reference is rejected) | |
| S20 | IPN: content type, timing against the callback, retries (answer 500 once and watch) | IPN handler | |
| S21 | Amount formats (`"400"`, `"400.00"`, a number, thousands separators?) | `parseAmountToMinor` | **Partly seen 2026-10-31:** v1 sent `"10.00"` and `"400.00"` for unpaid checkouts |
| S22 | What the checkout shows the payer: name, phone, email, whose merchant name | Privacy; the account switch (plan 13) | **Partly seen 2026-10-31:** the amount ("Pay BDT 400.00") and the methods (M-Banking, Cards, Net-Banking, EMI) |
| S23 | Accepted `cust_name` (Bangla?), `cust_phone` format, email rules | Form normalisation | |
| S24 | A `callback_url` with the invoice in its path: accepted, and parameters appended correctly? | Callback route | **Partly seen 2026-10-31:** initiate accepted `http://localhost:4100/api/payments/paystation/callback/<invoice>`; the redirect itself is still to see (S4) |
| S25 | Rate limits on the status API | Verify concurrency | |
| S26 | Only if it is easy: a refund in the panel shows as `trx_status = refund` on v1 | To see the `refund_reported` alert (no refund handling, owner) | |
| S27 | Can a `payment_url` be opened again after closing the tab? | Resume | |
| S28 | Time zone of `order_date_time` | Admin display | |
| S29 | Where is the IPN URL registered for a test account; is more than one allowed? | Plan 3.5, 8.1, 13 | |
| S30 | Must callback domains be whitelisted in the panel? | Plan 3.5, 13 | **Not for localhost in the sandbox:** initiate accepted a localhost callback (2026-10-31); the production domain is still to check |
| S31 | `paystation:selfcheck` against the configured account | Credentials and host of a server | **Done 2026-10-31 (sandbox):** `initiate: created (payment link host=sandbox.paystation.com.bd)`, exit 0 |
