# 06 — API surface (planned)

Prefix `/api`. Same origin as the web app. JSON only. Errors use the shape in `@sirat/shared` (`ApiError`). Lists return `Paginated<T>`. Every route has an explicit guard; the allow-list of public routes is below and a CI test fails on any unguarded route not in it.

Guards: `Public` · `Auth` (valid session) · `Role(...)` · `Owner` (resource belongs to session user, or admin).

## Public allow-list (reviewed)

`GET /health`, `GET /ready`, `POST /auth/login`, `POST /auth/refresh` (cookie), `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /registrations/start`, `GET /payments/paystation/callback`, `POST /payments/paystation/ipn`, `GET /content/*` (public site content), `GET /certificates/verify/:code`.

## Endpoints

| Module | Method + path | Guard | Notes |
|---|---|---|---|
| auth | `POST /auth/login` | Public, throttled | Sets httpOnly cookies |
| | `POST /auth/refresh` | Public (cookie) | Rotation + reuse detection |
| | `POST /auth/logout`, `POST /auth/logout-all` | Auth | |
| | `GET /auth/me` | Auth | Session user only; no writes in GET |
| | `POST /auth/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification` | Public, throttled | Identical responses (no enumeration) |
| | `POST /auth/change-password` | Auth | Revokes all sessions |
| users | `GET /users/me`, `PATCH /users/me` | Auth | **Allow-list DTO**: name, phone, district, institution, education, grade, photo |
| registrations | `POST /registrations/start` | Public, throttled | Creates pending registration + payment, returns `payment_url`. No `role` |
| payments | `GET /payments/:id/status` | Owner | Reads our DB |
| | `POST /payments/:id/recheck` | Owner, throttled | Calls PayStation status |
| | `GET /payments/paystation/callback` | Public | Hint only → status API → settle |
| | `POST /payments/paystation/ipn` | Public | Re-confirm via status API; idempotent |
| | `GET /payments/mine` | Auth | |
| exams | `GET /exams`, `GET /exams/:id` | Auth | Window state, never questions |
| attempts | `POST /exams/:id/attempts` | Auth + paid + verified | Start (server clock) |
| | `GET /attempts/me?exam=:id` | Owner | Resume |
| | `PUT /attempts/:id/checkpoint` | Owner | Redis only |
| | `POST /attempts/:id/submit` | Owner | Idempotent by `request_id` |
| | `GET /attempts/:id/review` | Owner | 403 until window closed for everyone |
| leaderboard | `GET /leaderboard?round=&page=&q=` | Auth | Snapshot; 404/403 until published |
| rounds | `GET /rounds/me` | Auth | |
| | `POST /rounds/:id/video` | Owner | Inside round window |
| certificates | `GET /certificates/mine`, `GET /certificates/:id/pdf` | Owner | |
| | `GET /certificates/verify/:code` | Public | |
| announcements | `GET /announcements` | Auth | |
| ambassadors | `GET /ambassador/me`, `POST /ambassador/teams`, `GET /ambassador/tasks`, `POST /ambassador/tasks/:id/submit` | Role(ambassador) | Own data only |
| admin (all `Role(admin)` unless noted) | `GET/PATCH /admin/users[/:id]`, `POST /admin/users/:id/role` | admin | Audited |
| | `CRUD /admin/exams`, `/admin/exams/:id/questions` | admin | Lock after publish |
| | `GET/PUT /admin/settings` | admin | Single writer |
| | `GET /admin/payments`, `POST /admin/payments/:id/reconcile` | admin | Audited |
| | `GET /admin/stats` | admin/manager | Cached |
| | `POST /admin/rounds/:id/promote` | admin | Idempotent, audited |
| | `GET/POST /admin/jury/*` | jury/admin | Judge recorded |
| | `CRUD /admin/announcements`, `/admin/ambassadors`, `/admin/tasks`, `/admin/rank-thresholds` | admin | |
| | `POST /admin/points/adjust` | admin | Compensating ledger entry |
| | `GET /admin/audit` | admin | |

## DTO and security rules

* `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Unknown fields are rejected, so `role`, `points`, `rank`, `status` can never be injected.
* Acting user = `req.user` from the verified cookie. Never `user_id` in body/query. Any `:id` is ownership-checked.
* State-changing requests require `X-Requested-With` (CSRF) on top of SameSite=Lax.
* Throttle tiers: auth endpoints strict; general API moderate; exam checkpoint/submit keyed by user (not only IP, schools share IPs).
* Responses never include `correct_key`, other users' data, stack traces or raw DB errors.
