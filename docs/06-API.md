# 06 — API surface (planned)

Prefix `/api`. Same origin as the web app. JSON only. Errors use the shape in `@sirat/shared` (`ApiError`). Lists return `Paginated<T>`. Every route has an explicit guard; the allow-list of public routes is below and a CI test fails on any unguarded route not in it (`apps/api/test/app-routes.int-spec.ts`, which also fails on a route registered outside a controller).

Guards: `Public` · `Auth` (valid session) · `Role(...)` · `Owner` (resource belongs to session user, or admin). Built (A2.1a): the global `AuthGuard` is deny by default; `@Public()` opens a route, `@Roles(...)` narrows it to roles from the token. `Owner` is a per-endpoint check in the service.

## Public allow-list (reviewed)

`GET /health`, `GET /ready`, `POST /auth/login`, `POST /auth/refresh` (cookie), `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /registrations/start`, `GET /payments/paystation/callback`, `POST /payments/paystation/ipn`, `GET /content/*` (public site content), `GET /certificates/verify/:code`.

## Endpoints

| Module | Method + path | Guard | Notes |
|---|---|---|---|
| auth | `POST /auth/login` | Public, throttled | Sets httpOnly cookies |
| | `POST /auth/refresh` | Public (cookie) | Rotation + reuse detection. 204 + new cookies; 409 = another tab refreshed a moment ago (retry); 401 = log in again (cookies cleared). Built (A2.1b) |
| | `POST /auth/logout`, `POST /auth/logout-all` | Auth | Logout ends this device's session family; logout-all ends all of them (audited). Built (A2.1b) |
| | `GET /auth/me` | Auth | Session user only, read fresh from the DB (`SessionUser`); a blocked user gets 401. No writes in GET. Built (A2.1b) |
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
* Session: the access token travels only in the httpOnly cookie `sirat_access` (an `Authorization` header is ignored). HS256, issuer `sirat-api`, audience `sirat-web`, 15 min, verified locally; claims `sub`, `role`, `sid`.
* State-changing requests (anything but GET/HEAD/OPTIONS) require a non-empty `X-Requested-With` header (CSRF) on top of SameSite=Lax, public routes included (login CSRF). The API never enables CORS. Only `POST /payments/paystation/ipn` may skip it (`@SkipCsrf()`, reviewed list in the routes test). GET handlers never change state.
* A handler that has not answered within 25 s gets 503 `Request timed out` (nginx gives up at 30 s); every DB statement stops at 10 s.
* Throttle tiers: auth endpoints strict; general API moderate; exam checkpoint/submit keyed by user (not only IP, schools share IPs).
* Responses never include `correct_key`, other users' data, stack traces or raw DB errors.
