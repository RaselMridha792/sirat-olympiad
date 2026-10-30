> **SUPERSEDED, do not use.** (owner, 2026-10-30) This summary was built from the public page and is wrong or outdated: the official merchant-dashboard Postman collection uses `POST /initiate-payment` and `POST /transaction-status`, not the endpoints below. Official sources are only the dashboard Postman collection and the official docs PDF. **Use `PAYSTATION-NOTES.md`** (the official docs, summarised). Open items: `docs/OPEN-QUESTIONS.md` (P1, P6–P8) and `SANDBOX-CHECKLIST.md`.

# PayStation API — notes for implementation

**Source:** the public page https://www.paystation.com.bd/documentation, read on 2026-10-30, plus the merchant dashboard (API Documentation page shows a Postman collection and **Sandbox Test Credentials**).
**Status:** this is a working summary, NOT the official document. If the dashboard's "Open Docs" or the Postman collection disagrees with anything here, the dashboard/Postman wins. Put the official files next to this one in `docs/paystation/` and update this file.

> `docs/RULEBOOK.md` section 8 was written earlier with different endpoint names (`/initiate-payment`, `/transaction-status`). The names below come from the page above. Reconcile RULEBOOK §8 after checking the official docs.

## Environments

| | URL |
|---|---|
| Live | `https://api.paystation.com.bd` |
| Sandbox | **Not stated on the public page.** The page says test and live store IDs are issued separately, and the merchant dashboard shows sandbox test credentials. Get the sandbox base URL from the dashboard's Open Docs or PayStation support |

`merchantId` and `password` are provided by PayStation (separate for test and live). Keep them in env vars only. Never commit, log, or paste them in chat.

## Flow

```
1. POST /grant-token            -> token
2. POST /create-payment         -> payment_url   (redirect the customer)
3. Customer pays on PayStation  -> browser returns to callback_url?status=...&invoice_number=...&trx_id=...
4. POST /retrive-transaction    -> data.trx_status  (the only source of truth)
```

## 1. Grant token

`POST {base}/grant-token`
Headers: `merchantId`, `password`
Success: `status_code 200` and a `token`. Failure example: `1001` Invalid Credential.
Token lifetime is not stated. Strategy: cache it; on `2001 Invalid Token`, fetch a new one once and retry.

## 2. Create payment

`POST {base}/create-payment`
Header: `token`

| Field | Required | Notes |
|---|---|---|
| `invoice_number` | yes | string, max 20 chars, must be unique |
| `currency` | yes | e.g. `BDT` |
| `payment_amount` | yes | decimal(10,2) |
| `cust_name` | yes | max 200 |
| `cust_phone` | yes | max 15 |
| `cust_email` | yes | max 50 |
| `callback_url` | yes | max 200 |
| `pay_with_charge` | no | `1` = customer pays the gateway charge, `0` = merchant pays |
| `reference` | no | max 20 |
| `cust_address` | no | max 255 |
| `checkout_items` | no | JSON-encoded string |
| `opt_a`, `opt_b`, `opt_c` | no | max 25 each |

Response: `status_code`, `status`, `message`, and `payment_url` on success (`status_code 200`). Any other code = failure. `2001` = Invalid Token.

## 3. Callback (browser redirect, a HINT only)

PayStation sends the browser to `callback_url` with URL parameters:

| Param | Values |
|---|---|
| `status` | `Successful`, `Failed`, `Canceled` |
| `invoice_number` | the invoice we sent |
| `trx_id` | only present for successful payments |

Never mark a payment paid from these parameters. Always confirm with step 4.

## 4. Retrieve transaction (verification)

`POST {base}/retrive-transaction` (the spelling "retrive" is how the page writes it; check the Postman collection)
Header: `token`
Body: `invoice_number` (required), `trx_id` (may be null)

Response: `status_code`, `status`, `message`, and `data`:

| Field | Meaning |
|---|---|
| `invoice_number` | our invoice |
| `trx_status` | `Success`, `Failed`, `Refund` |
| `trx_id` | gateway transaction id |
| `payment_amount` | amount paid |
| `order_date_time` | |
| `payer_mobile_no` | |
| `payment_method` | |
| `reference` | |
| `checkout_items` | |

**A `status_code 200` here only means the lookup worked. Check `data.trx_status`.**
Mark paid only when `trx_status == Success` (compare case-insensitively) AND `payment_amount` equals our stored amount AND `invoice_number` matches AND `trx_id` is not already used by another payment.

## Rules for our implementation

* Create our `payments` row first (`initiated`), then call create-payment. Use the row's invoice number (≤ 20 chars, unique, never reused).
* Callback handler: find the payment by `invoice_number`, call retrive-transaction, settle inside one DB transaction (row lock, unique `trx_id`). Replays are no-ops.
* Reconciliation job (every 2–5 min) re-checks every `initiated/pending` payment older than ~2 min, then marks `paid`, `failed` or `expired`.
* If a status call times out or errors, never assume failure. Retry; let the reconciliation job decide.
* Store the raw verification response (no secrets) in `payments.gateway_payload`.
* Never log `merchantId`, `password` or `token`.

## Not stated on the public page (ask PayStation / check Open Docs)

1. Sandbox base URL.
2. IPN (server-to-server notification): whether it exists, its format, retry rules. The public page does not mention it. Until confirmed, the system must be correct using only callback + retrive-transaction + reconciliation.
3. Token lifetime.
4. Checkout/payment-link expiry (default in our system: configurable, 60 min).
5. Refund API.
6. Rate limits.
7. Which payment methods are enabled on our merchant account.

## Sandbox test credentials

The merchant dashboard (API Documentation page) lists test credentials for bKash (test phone, PIN, OTP). Keep them in the dev notes of your own machine or password manager rather than in the repo.
