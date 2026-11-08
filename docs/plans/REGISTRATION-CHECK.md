# Design note: a privacy-safe public "registration check" (core, 2026-11-09)

**Status:** design only, no code. Approved by the lead (2026-11-09) with the defaults in section 7, which Rasel may override.
**Asked by:** the client (the website PDF: "রেজিস্ট্রেশন যাচাই — রেজিস্ট্রেশন নম্বর দিয়ে দেখে নিন আপনার রেজিস্ট্রেশন নিশ্চিত হয়েছে কিনা", and "ফোন নাম্বার অথবা ইমেইল দিয়ে যাচাই করুন"); queued for core by the lead on 2026-11-08.

## 1. What it is for

Someone paid and wants to know whether the registration went through, without logging in. For example: they closed the browser before the result page, the payment app was slow, or a parent or teacher paid for the student. Today they can only log in (an account exists only after a confirmed payment) or write to us.

## 2. The risk

Most participants are minors. A public page that answers "is this person registered?" is an oracle: anyone could test a classmate's phone number or email and learn that they take part, or harvest who did. The page must therefore:

- **answer only someone who already holds proof of the payment**, never someone who only knows who the person is;
- **show the status only**: no name, email, group, school, amount or date;
- give **one and the same answer** to everything that does not match (unknown invoice, wrong phone, a malformed value), in content, status code and timing;
- be **rate-limited** so that guessing is pointless;
- **log nothing** that identifies the person or the payment.

We already have one weaker oracle to keep in mind: `POST /registrations/start` answers 409 `EMAIL_REGISTERED` / `PHONE_REGISTERED` (limited to 10 per hour per email and per phone, and 300 per minute per IP). The check must not be a cheaper version of that.

## 3. Options

| | Input | Verdict |
|---|---|---|
| A | Phone **or** email alone (the client's wording) | **Rejected.** Anyone who knows a student's phone or email learns whether that student registered: the oracle in section 2, aimed at minors |
| B | **Invoice number + the mobile number used at registration** | **Recommended.** The invoice is on the payment result page and in PayStation's receipt, so only the payer, or someone the payer showed it to, has it. With the phone as a second factor, a leaked screenshot alone is not enough |
| C | Invoice number alone | Workable but weaker: one leaked receipt is enough. B costs the user one more field |
| D | A code sent by SMS (the PDF's "রেজিস্ট্রেশন কোড") | Not possible: we send no SMS (no provider, a running cost, and phones of minors); the invoice plays the code's role |

## 4. Proposed design (option B)

### API (payments' tables, so payments' module; see section 6)

`POST /api/registrations/check`, public (`@Public`), with the CSRF header like every public POST, and a DTO with `whitelist` and `forbidNonWhitelisted`:

```
{ invoiceNumber: string, phone: string }
```

- **Normalise:** the invoice is upper-cased and trimmed, and must match `^[A-Z0-9]{10,20}$`. The phone goes to the stored form `01[3-9]XXXXXXXX` (`+880`, `880`, spaces and dashes removed). A value that fails either check gets **the same "no match" answer**, not a 400: a 400 for "wrong format" would tell a guesser which part was wrong.
- **POST, not GET:** the values never appear in a URL, a log line, a Referer or the browser history (nginx already logs the path only).
- **Lookup:** find the payment by invoice → its attempt (`pending_registrations`) → compare the attempt's phone with the given phone (both normalised; a constant-time compare of their hashes). Anything that does not match ends in "no match".
- **Answer, only when both match:**

| The attempt | `status` | The page says (bn draft) |
|---|---|---|
| `completed` | `complete` | রেজিস্ট্রেশন সম্পন্ন হয়েছে। ইমেইল আর পাসওয়ার্ড দিয়ে লগইন করুন। |
| `awaiting_payment`, `confirming` | `confirming` | পেমেন্ট নিশ্চিত হচ্ছে। কিছুক্ষণ পরে আবার দেখুন; টাকা কেটে থাকলে আবার পেমেন্ট করবেন না। |
| `needs_help` | `needs_help` | আপনার পেমেন্ট আমরা হাতে দেখে নিচ্ছি। ইনভয়েস নম্বরসহ আমাদের লিখুন। |
| `failed`, `expired`, cancelled | `not_complete` | এই রেজিস্ট্রেশন সম্পন্ন হয়নি। আবার রেজিস্ট্রেশন করতে পারেন। |
| **no match, or a bad format** | `no_match` | এই তথ্যে কোনো রেজিস্ট্রেশন পাওয়া যায়নি। ইনভয়েস আর মোবাইল নম্বর মিলিয়ে দেখুন। |

  Showing the real state is fine once both factors match: whoever holds both is the payer. The state never reaches anyone without them.
- **Always 200** with `{ status }`, for every outcome above. Only the rate limit answers 429.
- **Timing:** the code path does the same work for a match and a miss (always one invoice lookup and one hash compare), and the answer waits for a fixed floor (e.g. 250 ms), so response times do not separate "unknown invoice" from "wrong phone".
- **Rate limits** (their own throttle tier and Redis keys):
  - 10 per minute and 30 per hour per IP;
  - 5 per hour per invoice and per phone, counted on **HMAC keys**, so no invoice or phone is written to Redis in clear;
  - over the limit: 429 with `Retry-After`, which the page shows politely.
  - Guessing is pointless anyway: 36¹⁰ possible invoices times a 10-digit phone.
- **Logging and audit:** no invoice, phone or result per person in any log. A counter per result (`registration_check_total{status}`) feeds monitoring; a spike of `no_match` raises the existing operator alert path.
- **Cache:** `Cache-Control: no-store`.

### Page (core)

`/registration-check` (Bangla) and `/en/registration-check`, in the public shell, linked from the FAQ ("টাকা কেটেছে, কিন্তু রেজিস্ট্রেশন নিশ্চিত হয়নি") and from the payment result page.

- A static page with one small client form:
  - two labelled fields: the invoice (`autocomplete="off"`, `inputmode="text"`, upper-cased as typed) and the mobile number (`type="tel"`, `autocomplete="tel"`);
  - one button, and the answer card in an `aria-live="polite"` region.
- No server rendering of answers; nothing is put in the URL; the fields are cleared after an answer.
- Help text: where to find the invoice (the result page, PayStation's receipt or SMS from the payment app), and "contact us" for anything else.
- The a11y rules of the site: one h1, the skip link, 24 px targets, the tokens; `noindex` like the other draft pages.

## 5. What it deliberately does not do

- No lookup by phone or email alone, no list, no partial matches, no "did you mean".
- No name, email, group, school, amount, date, or the next exam.
- No SMS, no email sent by the check.
- No account actions (no password reset, no resend): those stay behind login and the existing email flows.

## 6. Ownership and effort

- **API:** payments (their tables `payments`, `pending_registrations`), about half a day with tests.
- **Page:** core, about half a day.
- **Shared:** the public-routes allow-list in `app-routes.int-spec.ts` (A2's file) gets one line, announced; a new throttle tier.
- **Definition of done:**
  - integration tests: one per row of the answer table, `no_match` byte-identical for an unknown invoice, a wrong phone and a malformed value (apart from the request id), the limits, and nothing in the logs (a log-scan test as in the book module);
  - the page: the check-pages job, a CDP run, bn and en screenshots;
  - docs: 06-API, DECISIONS, RUNBOOK (what operators see).

## 7. Decisions: the lead's defaults (2026-11-09; Rasel may override)

1. **Inputs: invoice number plus mobile number**, not the client's "phone or email". Protecting minors from enumeration outweighs the client's wording; the lead explains this to Rasel.
2. **The failed and expired state is shown** to the holder of both factors. It is their own payment, and it tells them to register again instead of paying twice.
3. **Payments builds the API** (their tables); **core builds the page**.
4. **When:** after the demo data. Payments starts the API once its demo generator (part C) is merged, and core builds the page in parallel. The aim is before 25 Nov; it does not block the launch.
