# PayStation — implementation notes (no credentials)

**Sources (official only):** the PayStation documentation page https://www.paystation.com.bd/documentation (printed 2026-10-30 as `paystation.pdf`) and the merchant-dashboard Postman collection (`postmanCollection.json`). Both stay in this folder **locally and are git-ignored**, because they contain PayStation's shared sandbox test credentials. This file is the committed summary; it holds no credentials. Read and cross-checked 2026-10-30 (all 20 pages by two independent readers, plus the live page for lines the print hid). `PAYSTATION-API.md` is superseded.

## Environments

| `PAYSTATION_ENV` | Base URL |
|---|---|
| `sandbox` | `https://sandbox.paystation.com.bd` |
| `live` | `https://api.paystation.com.bd` |

- **Confirmed in the sandbox (S11, 2026-10-31):** sandbox credentials work only on `sandbox.paystation.com.bd`; on `api.paystation.com.bd` they get `"1001"` "Invalid Credential.". The docs' code samples and the Postman URL text show `api.…`; they are wrong for the sandbox. The two hosts sit in an allow-list in `payment.config.ts`, picked by `PAYSTATION_ENV` (DECISIONS 2026-10-31).
- **The merchant id is used exactly as issued, including any "-".** The Postman form and header values carry it; the docs' curl example drops it, and that form is refused (`"1001"`).
- `live` is refused unless `NODE_ENV=production` (owner decision).

## Authentication

- **initiate-payment:** `merchantId` + `password` in the form body.
- **transaction-status v1 and v2:** `merchantId` header only, no password.
- There is no token endpoint. `grant-token`, `create-payment` and `retrive-transaction` do not exist in the official docs (they came from an outdated summary).
- `2001` ("Invalid Token / Not Found") means *not found* **or** *credential mismatch*.

## 1. Initiate payment

`POST {base}/initiate-payment` — form-encoded body, `Accept: application/json`.

| Field | Docs | Our use |
|---|---|---|
| `merchantId`, `password` | required | from env only |
| `invoice_number` | required, unique; **no length limit stated** | we generate ≤ 20 chars, unique, never reused |
| `currency` | optional | always send `BDT` |
| `payment_amount` | required, **integer** | whole BDT, so `amount_minor` must be a multiple of 100 |
| `pay_with_charge` | marked required, `1` customer / `0` merchant, "default 0" | always send explicitly (OPEN-QUESTIONS P6) |
| `reference` | optional, echoed back by the status APIs | our payment id (cross-check) |
| `cust_name`, `cust_phone`, `cust_email` | required | from the registration form |
| `cust_address` | optional | not sent |
| `callback_url` | required | our URL with the invoice in the path, ≤ 200 chars |
| `checkout_items`, `opt_a`, `opt_b`, `opt_c` | optional | not sent |
| `emi` | optional | not sent |

Response: `status_code` is a **string**. `"200"` carries `payment_url`; `"1008"` = duplicate invoice; any other code = failure. Seen in the sandbox but not in the docs: `"1001"` "Invalid Credential." (wrong merchant id or password, or the wrong host).

## 2. Browser callback (a hint only)

- The docs only say the customer is sent back to `callback_url` "with parameters indicating payment outcomes". **Parameter names and values, the HTTP method, and whether cancel/failure also return are not documented** (OPEN-QUESTIONS P1).
- PayStation's own WooCommerce and OpenCart plugins read GET `status`, `invoice_number`, `trx_id` and treat `status=canceled` as cancelled. That is plugin code, not API documentation.
- **Our rule:** `callback_url = <APP_URL>/api/payments/paystation/callback/<invoice_number>`. The invoice in the path is also only a hint. Nothing is marked paid from callback data; we always verify through transaction status.

## 3. Transaction status

| | v1 | v2 |
|---|---|---|
| Request | `POST {base}/transaction-status`, header `merchantId`, form-encoded `invoice_number` | `POST {base}/v2/transaction-status`, headers `merchantId` + `Content-Type: application/json`, JSON `{"trxId": "…"}` |
| When | always (we know our invoice) — reconciliation, re-check button, callback | only once a `trx_id` is known (callback/IPN) |
| Extra fields | — | `trx_amount` (number), `trx_date`, `request_amount`, `payment_amount` |

Response: `status_code` (string), `status` (`success`/`failed` = whether the **lookup** worked), `message`, and `data` only when `status_code` is `"200"`: `invoice_number`, `trx_status`, `trx_id` (empty string when none), `payment_amount` (`"120"` or `"120.00"`), `order_date_time`, `payer_mobile_no`, `payment_method`, `reference`, `checkout_items`. The docs show `trx_status` both capitalised and lowercase. A top-level `status` of `success` does **not** mean paid (docs p.10 show `status: success` with `trx_status: Failed`).

**Decision rules (owner, 2026-10-30):**
- **paid** only if `status_code` is `"200"` AND `lowercase(data.trx_status)` is `success` or `successful` AND the amount matches exactly (decimal parse into paisa) AND `invoice_number` matches AND `trx_id` is non-empty and not used by another payment.
- **failed** only if `lowercase(trx_status)` is `failed`. **refund** never changes a paid payment: there is no refund handling (owner, 2026-10-31, DECISIONS "No refund handling"). It is recorded as `refund_reported` with a critical alert.
- `processing` stays pending. **Any other or unknown value is neither paid nor failed**: it stays pending, the reconciliation job looks again, and an alert is raised. The list is updated after the sandbox shows the real values.
- **`2001` is never failed** (not found or wrong credentials): stay pending until our expiry; alert when it repeats across payments.
- An empty `trx_id` is stored as **NULL** (so `UNIQUE(trx_id)` does not collide).
- Timeouts and errors are never failed: retry, and let the reconciliation job decide.

## 4. IPN (server-to-server notification)

- Sent **only for successful transactions**, `POST` with a JSON body to an HTTPS URL we register with PayStation (per merchant). **No auth, no signature.** PayStation's server IPs are not published.
- Retried "a limited number of times with a delay" on non-2xx or timeout; count and interval are not documented.
- Payload (flat JSON): `invoice_number`, `trx_status` (`"Success"`), `trx_id`, `trx_amount` (number, BDT), `order_date_time` (`Y-m-d H:i:s`, timezone not stated), `payment_method`, `reference` (optional; the provider's reference, not ours).
- **Our handling (RULEBOOK §8.2):** store the raw body; re-confirm through transaction status before marking paid; idempotent by invoice and `trx_id`; reply 200 quickly for processed, duplicate, and recorded-but-rejected IPNs (alert on rejects); never move `paid` back to unpaid.

## 5. Not documented

Checkout/payment-link expiry (we use 60 min, configurable), IPN retry count and interval, rate limits (a menu entry without content), **any refund API** (none; refunds only appear as `trx_status = refund`, see RUNBOOK "Payments: refunds and manual reconciliation"), callback parameters (P1), the effect of `pay_with_charge` on amounts (P6).

## 6. Sandbox

The docs page publishes shared sandbox test credentials, test cards (OTP simulator) and a Postman collection. Keep credentials in your local `.env` only. Checks to run: `SANDBOX-CHECKLIST.md`.
