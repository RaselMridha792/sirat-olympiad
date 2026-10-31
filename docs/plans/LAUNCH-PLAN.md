# Launch readiness: plan (first release, 15 November 2026)

Plan only, no product code (2026-10-31, branch `feat/a2-launch-plan`, A2 session). It reaches `main` in a docs-only pull request that the lead reviews and merges. No code starts before that review.

**Launch:** registration and payment only (Lead, 2026-10-31). A student registers, pays, logs in and sees their own registration and payment status. All times below are estimates at the measured pace (section 12), not promises.

Sources: RULEBOOK §3, §5, §6, §11–§14, §18; RUNBOOK §2, §4, §5, §9, §10, §12; `plans/PAYMENTS-PLAN.md` §10, §12, §13; `plans/EXAM-PLAN.md`; DECISIONS (A1 approval, A2.1b, A2.1e, "Per-user API limits"); OPEN-QUESTIONS #17, #18, #23, #27. Six read-only passes over `main` at aef64c9 (deploy, TLS, backups, DB role and cleanup, monitoring, dashboards) established today's state; the claims this plan rests on were checked again by hand.

## 0. Scope, dependencies and dates

- **This plan (A2):** the eight areas the lead listed on 2026-10-31 (22:26), the email (SES) items of the checklist, and nginx logs without query strings (Lead, 22:58).
- **Other sessions:**
  - **payments:** the registration API, the wizard, the PayStation live switch, the real payment and the k6 registration surge (`PAYMENTS-PLAN.md` §10, §13). The per-IP tiers of `/registrations/*` are sized there; section 3 proposes numbers.
  - **exam:** the exam and leaderboard pages are wired later (E4/E5). Until then they say "coming soon" (section 8).
  - **core:** the minimal public entry page and the privacy, terms and refund-policy pages; also the admin students list, profile, announcements and ambassador. Their dashboard pages say "coming soon" until core turns them live.
- **Outside dates** (`PAYMENTS-PLAN.md` §10.2): domain Mon 2 Nov (latest Wed 4); VPS Sat 7 Nov (latest Tue 10); live merchant Tue 10 (latest Thu 12); SES production access requested the day the domain arrives, granted by Wed 11 (latest Fri 13).
- **Rules throughout:** no deploy during a live exam window (`deploy.sh` refuses one, section 2); nothing secret in git, logs or messages; the shared stack only with the lead's or Rasel's go-ahead.

## 1. Summary

| § | Area | Now, without the VPS | Waits for the domain or the VPS | PRs (estimate) |
|---|---|---|---|---|
| 2 | Deploy and rollback | SHA-tagged images; `deploy.sh` (preflight, migrate first, smoke, automatic rollback without a build); `bootstrap.sh`; rehearsal in a separate local compose project | bootstrap and first deploy; deploy, second deploy, forced rollback and reboot rehearsed on the VPS | L9 3–4 h; L12 (part) |
| 3 | TLS, real IPs, logs | 443 for Cloudflare Full (strict); HSTS from nginx only; `no-store` on `/api`; logs without query strings; real-IP test harness; zones sized for shared IPs | Origin CA certificate, Cloudflare settings, firewall, real-IP check on the mobile networks, k6 numbers | L3 2.5–3 h; L4 2–2.5 h |
| 4 | Backups | encrypted dumps shipped off-server (a local remote in tests); restore into an empty database; a scripted drill, run locally and in CI | bucket and keys (owner); timers on the VPS; drill from a real VPS copy on another machine | L6 2 h; L7 2–3 h |
| 5 | Runtime DB role | role, grants, boot line, the app tested as the role; then the switch | the first VPS deploy starts with the role | L2 2 h; L8 1–1.5 h |
| 6 | Monitoring | alert categories with their own caps; `ops-check`; `monitor.sh`; heartbeats; daily digest | outside monitors on the domain; cron on the VPS; fake-alert drill | L10 2 h; L11 3.5–4 h |
| 7 | Maintenance, checklist | maintenance switch (503 page, the IPN still passes); `prelaunch-check.sh`; RUNBOOK §9 as T-7 → T-0 | switch tested through Cloudflare; checklist on the VPS; go/no-go | L5 2 h; L12 (part) |
| 8 | "Coming soon" | launch table, `ComingSoon` component, page guards, a home page that needs no `getHome()` | one pass on the server as a real student and admin | L1 2–2.5 h |
| 9 | Cleanup job | per-family session purge, token purge, indexes, a nightly job in the worker | first run on the VPS | L13 1.5–2 h |

L12 is `bootstrap.sh` + `prelaunch-check.sh` + RUNBOOK §9 (4–5 h). In all: 13 PRs, about 32 session-hours.

## 2. Deploy and rollback

**Today.** RUNBOOK §2 is a manual list, never run on a VPS. Compose gives images no tag, so each build overwrites `:latest` and a rollback means rebuilding the old commit (slow, and it needs npm and Docker Hub during an incident). A plain `up -d` can recreate data services. Nothing enforces "green CI only" or "no deploy in an exam window". `bootstrap.sh` only prints its steps. Each deploy leaves 10–20 s with no API, because all replicas restart (RUNBOOK §2).

**Now, L9 (3–4 h).**
- Compose: `image: sirat-<service>:${SIRAT_TAG:-latest}`, so CI and local runs keep `latest`.
- `scripts/deploy.sh <sha>`:
  1. **Preflight:** a lock; not root; `.env` mode 600; a clean tree; exported `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_*` and `COMPOSE_*` unset; the dev override refused; free disk; the SHA is on `origin/main` and its CI run passed; no exam window open within ±30 min (psql inside the postgres container, as `backup.sh` does); data services healthy, since a deploy never starts or recreates them.
  2. Build the tagged images while the old release serves.
  3. Take a backup first when the release adds migrations.
  4. `run --rm migrate`. It must print `config seed done`; on failure the script stops and the old API keeps serving.
  5. `up -d --no-deps --no-build --wait api worker web`. nginx is reloaded only when `infra/nginx` changed.
  6. **Smoke:** exact 200s with the expected body (`curl -f` passes a 301); each new API replica's PayStation boot line (section 7); the worker healthy; `migrate status` up to date.
  7. **Success:** record the release, keep the last 3 image sets (never volumes). **Failure:** roll back to the previous tag with no build, smoke again, and print loudly that migrations stay applied. `deploy.sh --rollback` does the same by hand.
- RUNBOOK §2 rewritten around the script. The lead's dev rule (`$DCD up -d --build --no-deps migrate api worker web nginx`) goes into RUNBOOK §0.
- **Rehearsal without the VPS**, in a separate compose project (`sirat-rh`: nginx on 127.0.0.1:18080/18443, no data ports, throwaway secrets, a self-signed certificate), in this order:
  1. release A;
  2. release B with a migration, under a request loop;
  3. a commit whose API fails at boot: automatic rollback, timed;
  4. a failing migration: stops before any restart;
  5. maintenance on and off.

  The data containers' start times must not change. It shares only CPU and RAM with the shared stack, so it is announced.
- **`bootstrap.sh`** (in L12): idempotent, with `--dry-run` and shellcheck in CI. For Ubuntu 24.04 it sets up:
  - Docker at the versions CI uses;
  - a `deploy` user, SSH keys only, no root login;
  - the firewall in the provider panel or as DOCKER-USER rules, because UFW does not filter Docker-published ports;
  - fail2ban, chrony, security updates without automatic reboot, swap, `vm.overcommit_memory=1`;
  - a clone with a read-only deploy key;
  - `.env` from the example at mode 600, for the owner to type the secrets into;
  - the backup and monitor timers.

  It is tested in a throwaway Ubuntu VM and timed against the 1-hour rebuild target (RULEBOOK §3).

**Waits for the VPS.**
- The specs confirmed, and the Postgres and compose limits retuned (today they assume 8 vCPU and 32 GB).
- bootstrap run and timed; the owner types the secrets.
- The first deploy on an empty database; the first admins created with the CLI (RUNBOOK §13).
- Deploy, second deploy, forced rollback and a reboot, rehearsed and timed.

**Known limit at launch:** the 10–20 s gap per deploy stays. Deploys happen off-peak, and with L5 the gap shows the maintenance page instead of a raw 502. Zero-downtime switching comes after launch.

## 3. TLS behind Cloudflare, real client IPs, shared IPs, logs

**Today.**
- nginx listens on 80 only; 443 and HSTS are TODOs. Compose publishes 80 and 443 on every interface, and `infra/nginx/certs/` has no tracked file. Cloudflare could only use Flexible mode, which is plain text between Cloudflare and the server.
- The real-IP restore is in place and correct: `cloudflare-realip.conf` trusts only Cloudflare's ranges and reads `CF-Connecting-IP`, and the API takes nginx's restored address (`trust proxy 1`).
- The API's helmet sends HSTS for 1 year with `includeSubDomains` by default. That would bind every subdomain of the client's domain the moment HTTPS works.
- nginx writes the default `combined` access log, query strings included.

**Now, L3 "TLS-ready nginx" (2.5–3 h).**
- **Config:** nginx.conf is split into http-level settings, an `app-locations.conf` include (today's locations, unchanged) and one site file.
  - The production site is a template filled from the public host. Port 80 answers `/healthz` and redirects everything else to https. A default 443 server refuses unknown names at the handshake. The real 443 server has HTTP/2, TLS 1.2/1.3 and the Cloudflare Origin CA certificate.
  - The dev and CI site file stays plain http on 8080, so e2e and the smoke test do not change.
- Directory mounts instead of single-file mounts. Ports bound to IPv4 only: with no IPv6 listener, Docker never replaces the client address. Add `certs/.gitkeep`.
- **Headers:** one include with nosniff, Referrer-Policy and HSTS, used also inside the `@api_*` error locations. HSTS comes only from nginx: helmet's is turned off, and an API test checks it. `/api` gets `Cache-Control: no-store`.
- **Logs (Lead, 22:58):** the access log uses `$uri`, never `$request` or `$request_uri`. So `?q=` search terms, for example from core's `/admin/users?q=<name or phone>`, never reach a log. The log adds request time, upstream status and the Cloudflare edge address.
  - nginx's error log also writes the full request line, so it runs at `crit`. 429s and upstream errors then appear only in the access log, which already carries status, upstream status and timing.
  - Test: a request with a random `?q=` value, which must then be absent from `docker logs nginx` (access and error log). The API already logs paths without query strings.
- `APP_URL` must be https in production unless its host is local. `nginx -t` runs both site files with a throwaway certificate, in CI and in `refresh-cloudflare-ips.sh`.

**Now, L4 "real IPs and shared IPs" (2–2.5 h, after L3).**
- **Test harness:** its own Docker network, stub upstreams and a fake "Cloudflare" peer; no shared stack and no fixed ports. It runs in the CI docker job and checks that:
  - the restore works from a trusted peer, and a spoofed header from anyone else is ignored;
  - one IP's 429 does not touch another IP;
  - two IPv6 addresses in one /64 share a bucket;
  - TLS sends exactly one HSTS header, and an unknown name is refused;
  - http redirects, and `/healthz` answers 200 on 80.
- **Shared IPs** (school labs, mobile carrier-grade NAT). After the restore there is one bucket per real IP: precise for broadband and IPv6, coarse for a school or an operator IP. Today, all students behind one such IP share:
  - nginx `auth` 20 r/s (burst 200) and `api` 30 r/s (burst 60); the second covers every signed-in call and the registration poll;
  - the API's 600 per minute per IP for anonymous calls, about 20 students polling every 2 s;
  - the login limiter's 100 failures per minute per IP (owner rule).
- **L4 changes:**
  - the zones are keyed per IPv4 address or per IPv6 /64;
  - they rise to `auth` 100 r/s (burst 1,000) and `api` 200 r/s (burst 2,000), the proposal in DECISIONS "Per-user API limits";
  - the API's refresh tier rises in step, to at least the api zone's rate per minute;
  - no per-IP `limit_conn`, since it would refuse a school.

  The final numbers come from k6 on the VPS with simulated shared IPs.
- **Payments (in their PR):**
  - `POST /registrations/start`: 30 per minute per IP is low for a school lab. Proposed: about 300 per IP, keeping the 10 per hour per email and per phone.
  - `GET /registrations/current`: keyed on the registration cookie (about 60 per minute) with a per-IP ceiling.
- **RUNBOOK "TLS and Cloudflare"** (docs, in L3 or L4):
  - the Cloudflare checklist:
    - Full (strict), Always Use HTTPS, minimum TLS 1.2;
    - Bot Fight Mode off, because it can block PayStation's unsigned IPN, plus a rule that skips challenges on the IPN path;
    - Email Obfuscation, Rocket Loader, "Remove visitor IP headers" and Pseudo IPv4 off;
    - no "cache everything"; SES records DNS-only; an A record only;
  - the order on VPS day: certificate, then Full (strict), then the redirect;
  - what errors 520–526 mean; the origin-direct check; the real-IP check in the access log;
  - the HSTS ramp; the k6 procedure with a temporarily trusted generator;
  - a firewall script (Cloudflare ranges on 80/443) for the provider panel or DOCKER-USER, dry-run by default.

**Waits for the domain or the VPS.**
- The zone active on Cloudflare (minutes to 48 h; days for a .bd domain).
- The Origin CA certificate, its key made and kept on the VPS at mode 600.
- `.env` with the https `APP_URL` and the production callback and IPN URLs.
- The firewall applied, and an outside scan showing only 22/80/443.
- Real client addresses in the access log from broadband, the three mobile operators and an IPv6 phone.
- A PayStation IPN that reaches the server through Cloudflare without a challenge.
- The k6 numbers recorded in DECISIONS.

## 4. Backups and a restore drill

**Today.**
- `backup.sh` writes a verified local dump, marked "NOT yet off-server". `restore.sh` restores over the live schema with `--clean` and was never rehearsed end to end.
- There is no schedule, encryption, retention, alert or off-server copy. RULEBOOK §6 wants nightly copies off the server, 7 daily + 4 weekly, an alert on failure and a drill on another machine.
- **Two silent gaps:**
  - A restore into a fresh database drops the database-level timeouts (10 s / 5 s / 60 s). `pg_restore` applies them only with `--create`, and the migration that set them is already marked applied.
  - A restore over a schema that has a later migration breaks the migrate job.

**Now, L6 "encrypted off-server backups" (2 h).**
- `pg_dump -Fc --lock-wait-timeout`: hourly while registration is open, daily otherwise. A lock stops overlapping runs, and the full-read check stays.
- Encrypted with age to public keys in `infra/backup/recipients.txt`; the private keys stay with the key holders (Q1). A manifest holds the sha256 and the row count per table. A dump much smaller than the last one fails the run.
- **Upload:** rclone with a put-only key; 3 local copies outside the repo (`/var/backups/sirat`).
- **Config:** a root-only file (`/etc/sirat/backup.env`), never the root `.env`, which reaches every API replica and the worker.
- **Heartbeat:** a ping after each verified upload, and `/fail` on any error (section 6).
- **Tests**, in a separate compose project with a throwaway key and a local rclone remote:
  - a normal run succeeds;
  - a dump killed midway leaves no file;
  - a bad remote exits non-zero and pings `/fail`;
  - the throwaway key decrypts the upload, and the counts match.

**Now, L7 "restore into an empty database, scripted drill" (2–3 h).**
- **`restore.sh`, two modes:**
  - **Rebuild:** into an empty database on a fresh volume, with no `--clean`; the timeouts are re-applied and checked, then migrate and start. This also fixes bootstrap's order.
  - **Server still up:** restore into `sirat_restore_<stamp>`, check it, stop traffic, swap the names, and keep the old database for payments newer than the dump.
- **Before it acts,** it prints the project, the database and the server marker, and asks for the project name to be typed. It refuses a server marked as development unless told otherwise, and it stops the worker too.
- **After a restore:**
  - the cache is flushed;
  - everyone logs in again, because session and token rows are not restored;
  - the JWT secret is rotated;
  - payments since the dump time minus 1 h are compared with a PayStation export.
- **`restore-drill.sh`:**
  1. download, and check the sha256 against the manifest;
  2. decrypt and restore into a drill project (payments off, email to Mailpit);
  3. check the migrations, counts and triggers, `SHOW statement_timeout` = 10s, and that the audit log refuses a delete;
  4. one login;
  5. wipe, and print the measured restore time.
- **CI round trip** in the docker job: create admin A, back up, create admin B, restore. A logs in (204), B does not (401), the counts match and the timeouts are back.
- **The local drill the lead asked for:** L7 runs it in its own compose project, with no shared stack. With the lead's go-ahead it runs once more on a read-only `pg_dump` of the shared dev database. The results and timings go in the PR.

**Waits for the owner or the VPS.**
- **Owner (Q1), any day before 7 Nov, no VPS needed:** the bucket with versioning and lifecycle rules (hourly copies 2 days, daily 8, weekly 35), a put-only key for the VPS and a read-only key for drills. The key holders make the age keys offline.
- **VPS:** the timers; the first copy seen in the bucket; a forced failure that reaches the owner.
- **Drills from a real VPS copy on another machine:**
  - before registration opens (about 10–11 Nov);
  - again at T-2 (13 Nov);
  - then weekly while registration is open.
- WAL archiving (point-in-time recovery) only after launch.

## 5. Runtime DB role (OPEN-QUESTIONS #27)

**Today.** The API, the worker, the seed and the CLI connect as the bootstrap superuser, which also owns every table. So an injected statement could:
- disable the append-only triggers (`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role`);
- truncate tables;
- run shell commands (`COPY … TO PROGRAM`).

The superuser password also sits in every app container through `env_file`. The owner put the role on the pre-launch checklist (DECISIONS "A1 approval" #5, RUNBOOK §9).

**Now, L2 "role and grants" (2 h; nothing switches yet).**
- **A hand-written migration:**
  - creates `sirat_app` if missing, with no superuser, createdb, createrole, replication or bypassrls;
  - grants CONNECT, USAGE and SELECT/INSERT/UPDATE/DELETE on the app tables;
  - grants only SELECT/INSERT on `audit_logs`, `payment_events` and `submissions`, and nothing on `_prisma_migrations`;
  - sets default privileges, so every future table gets the same DML.
- **`prisma/runtime-role.mjs`**, run by the migrate job after `migrate deploy`:
  - sets the role's login and password with a SCRAM verifier computed locally, so the plaintext never reaches Postgres or its log;
  - manages only the fixed name `sirat_app`;
  - re-applies the three database timeouts, which closes the restore gap of section 4;
  - prints one line and never a value.
- **A boot line** in the API and the worker: `database role=<name> superuser=<bool>`. In L2 it warns; after L8 production refuses to boot as a superuser.
- **Tests:**
  - the whole integration suite runs the app as `sirat_app`, so a missing grant fails in CI, not in production;
  - a catalog test checks every table's privileges;
  - as `sirat_app`, each of these fails with 42501: TRUNCATE, DISABLE TRIGGER, `session_replication_role`, DDL, `COPY … TO PROGRAM`, reading `_prisma_migrations`, UPDATE/DELETE on the append-only tables;
  - mutation checks on the default privileges, the append-only REVOKE and the timeout re-apply.

**Now, L8 "switch to the role" (1–1.5 h, before the first VPS deploy).**
- **Connections:**
  - PgBouncer knows only `sirat_app`;
  - `DATABASE_URL` uses it for the API, the worker, the seed and the CLI;
  - `DIRECT_URL` (the superuser) goes only to the migrate job;
  - the API and worker containers get the superuser variables blanked.
- **Also changes:** both `.env.example` files; the CI docker job (migrate, seed and `/api/ready` through PgBouncer as `sirat_app`); `restore.sh`, which refuses to run before the role exists; 05-DATABASE; RUNBOOK.
- **On the shared dev stack** the switch needs one window that the lead and Rasel pick:
  - PgBouncer is recreated, so every session's pooled connections drop;
  - Rasel types the same `sirat_app` password into the root `.env` and into every worktree's `apps/api/.env`. Roles belong to the whole Postgres cluster, so dev and test databases need one password, or each test run resets it for everyone;
  - sessions never read `.env`.

**Waits for the VPS.** The first deploy starts with the role, so there is never a live switch:
- the migrate log shows `runtime role ready`;
- the boot line shows `superuser=false`;
- `pg_stat_activity` shows only `sirat_app` for pooled connections.

## 6. Monitoring and alerts

**Today.**
- `/api/health` (liveness) and `/api/ready` (Postgres through PgBouncer, both Redis) exist, and every long-running service has a Docker healthcheck.
- Alerts have one path. `SecurityAlerts` writes an audit row and a log line, then sends an email through the cache Redis, the queue Redis, the worker and SES. One cap of 6 emails an hour is shared by every kind (owner, DECISIONS A2.1e #6).
- Nothing watches from outside, and nothing checks disk, memory, queues or 5xx. `healthcheck.sh` treats a 3xx as success.
- Docker never restarts a container that is only "unhealthy", and nginx keeps sending it traffic.

**For launch: two paths that do not depend on each other.**
- **Outside** (a free-tier uptime and heartbeat service, Q2):
  - checks `https://<domain>/api/ready` (by keyword, alerting after 2 failures) and `/` every 1–5 min, plus certificate expiry;
  - two heartbeats: `monitor.sh` on every run, and `backup.sh` after each verified upload;
  - alerts by email and Telegram or its phone app, so it still works when our Redis, worker, SES or the whole VPS is down.
- **Inside:**
  - `scripts/monitor.sh` runs from cron every 5 min. It collects host facts: disk, memory, swap, containers, the last 5 min of nginx and API logs, backup age, certificate end date, time sync.
  - It passes them to an `ops-check` CLI in the API container, which adds queue counts and connected workers, Redis memory, and Postgres connections and locks.
  - The thresholds live in TypeScript. An alert fires only when a check changes state, then an hourly reminder, and one "resolved" line at the end.
  - A daily digest at 08:00 Asia/Dhaka (held-back alerts, backups, disk, payment counts) also proves each morning that email works.
- **Default thresholds** (tuned after k6 on the VPS):
  - disk: warn at 80%, critical at 90%; any swap use warns;
  - containers: unhealthy or not running on two runs is critical;
  - queue Redis memory: warn at 300 MB, critical at 400 MB (of 512);
  - workers: zero is critical; more than 500 waiting jobs, or an oldest job older than 5 min, warns;
  - nginx 5xx: above 2% warns (with at least 50 requests), above 10% is critical;
  - API p95 above 1 s warns;
  - certificate: under 14 days warns;
  - backups: the newest older than 26 h is critical.
- **Payment alerts** (the decision levels, payments stuck past expiry, a late reconciliation) come with payments PR 3, their step 8. `ops-check` adds only the generic part: the payments queue has workers and the reconciliation job ran recently (about 0.5 h, after payments PR 3 merges).

**PRs.**
- **L10 (2 h):**
  - alert categories (security, payments, ops), each with its own hourly cap (Q2), and the subject by category;
  - no "Account:" line when there is no account;
  - a production boot warning when `SECURITY_ALERT_EMAIL` is blank;
  - an `ops-alert` CLI with an allow-list of kinds.

  It edits the kind list that payments also edits, so the two merge one after the other.
- **L11 (3.5–4 h):**
  - the `ops-check` CLI: table tests for every threshold, and int tests (a backlog with no worker, a failed job, a state change that alerts once);
  - `monitor.sh` with shell tests on faked commands;
  - `healthcheck.sh` and `monitor.sh` require exactly 200;
  - the backup heartbeat;
  - `monitor.sh --dry-run` in the CI docker job;
  - RUNBOOK §1/§7: copy-paste commands and an "alert → action" table.

**Waits for the domain or the VPS.**
- The outside checks, which need the domain and TLS.
- Real alert email: the SES domain identity, then production access. Until then the alert inbox is verified as an SES recipient.
- On the VPS: the cron, and `.env.monitor` with the heartbeat URLs.
- The fake-alert drill with Rasel present, on both paths (RULEBOOK §13). A stopped worker, a stopped API and a lowered disk threshold must each raise an alert.

**Not at launch:** Sentry (minors' data would leave the server; decide before the exam phase) and Prometheus/Grafana.

## 7. Maintenance page and the pre-launch checklist

**Today.** There is no maintenance mode: RUNBOOK §4 is a TODO, and RULEBOOK §14 requires one. During a web restart visitors get nginx's raw 502. The restore procedure stops nginx, so visitors get Cloudflare's "origin down", and it leaves the worker running.

**Now, L5 "maintenance mode" (2 h, after L4).**
- **The switch:** a flag file in a git-ignored folder, checked by nginx on every request, so no reload or restart is needed.
- **With the flag set,** every location answers 503 except:
  - `/healthz`;
  - the PayStation IPN, which only records and queues; PayStation retries, and reconciliation catches anything missed.
- **Answers:** HTML for pages and for the PayStation callback page; JSON `code: MAINTENANCE` for other `/api` calls; Retry-After, `no-store` and the security headers on both. 127.0.0.1 bypasses the switch, for checks from the server.
- The same page replaces nginx's own 502/504 on pages and on the callback, which covers every deploy gap.
- **Text:** bilingual (Q5), with the line "if you just paid, your payment is safe; we confirm it automatically".
- **`scripts/maintenance.sh on|off|status`:** it touches only the flag file and never runs up, down or restart.
- **RUNBOOK:** §4 written. §5 restore becomes: maintenance on, stop web, api and worker, keep nginx running.
- **CI docker job:**
  - flag on: the page answers 503 with the HTML, `/api/ready` 503 MAINTENANCE, `/healthz` 200; the IPN reaches the API; the bypass answers 200; the data services are untouched;
  - flag off: 200.

**Now, the checklist (in L12, with `bootstrap.sh`).**
- **RUNBOOK §9,** rewritten as T-7 → T-0 for this launch. New items:
  - Cloudflare settings and TLS; an outside port scan;
  - deploy, rollback and maintenance rehearsed on the VPS;
  - an off-server backup and a passed drill; the runtime role;
  - outside monitors and a fake alert received;
  - contacts filled in (RUNBOOK §8); the release SHA green on `main`;
  - the kill switches, in order: `registration_open=false`, then maintenance on, then `deploy.sh --rollback`.
- **The PayStation boot line** (payments' item, RUNBOOK §9) is checked automatically for **each** API replica since the deploy. It must show:
  - `env=live` and the live host;
  - the client's account label and invoice prefix;
  - an https callback and IPN on the domain;
  - no "payments are DISABLED".

  `paystation:selfcheck` must also exit 0.
- **Email (SES):**
  - the domain verified (DKIM, MAIL FROM, DMARC) and production access granted;
  - `EMAIL_PROVIDER=ses`, one real email received, the worker healthy;
  - the IAM keys in `.env` before registration opens, even while production access is pending: the worker refuses to start without a usable email configuration, and it is the worker that will confirm payments.
- **`scripts/prelaunch-check.sh`** prints PASS/FAIL lines and never a value. It checks:
  - only nginx publishes ports;
  - `.env` is mode 600, `APP_URL` is https and `COOKIE_SECURE` is not false;
  - no development marker on Postgres, and no Mailpit;
  - the boot lines; migrations up to date;
  - a clean production database: no fixture users, no test invoices, no published exam, fee 40000, `registration_open` as intended;
  - the newest backup under 26 h old, with its off-server copy;
  - the worker healthy with SES;
  - time synced; disk and swap fine; the age of the Cloudflare IP list; the release SHA.

  `--local` marks the VPS-only checks N/A, so it also runs in the rehearsal project and in CI.

**Waits for the VPS.**
- Maintenance on and off through Cloudflare: the 503 page is shown and not cached, and the IPN passes.
- `prelaunch-check.sh` all PASS on the VPS, and a fresh backup minutes before opening.
- Rasel's go/no-go on 14 Nov; then registration is opened through the audited admin setting.
- For the first week, the PayStation panel is compared with the database every day (`PAYMENTS-PLAN.md` §13.5).

## 8. Dashboard pages without data at launch: "coming soon"

**Today: a launch blocker.**
- In production every data call throws, so each page shows its error state: "Something went wrong… check your connection", with a retry that can never work.
- `/dashboard` always calls `getHome()`, and `GET /dashboard/home` is built nowhere. So a student who pays and logs in lands on an error page, and payments' status card has nowhere to render.
- The error state cannot tell "not built" from "broken", and every such view is a 5xx that the alerts would count.
- `/dashboard/ambassador` shows invented numbers, in English only.

**Now, L1 (2–2.5 h).** It goes first, because payments' web PR changes the same files on Thu 5 Nov.
- **Launch table:** `apps/web/src/data/launch.ts` maps each route to `live` or `soon`, plus keys for the home sections. The production data source becomes an http skeleton with `isLive()`; payments and exam add their methods and flip their own entries.
- **`ComingSoon`** in `packages/ui`: `role="status"`, `data-state="coming-soon"`, neutral tokens, no retry button. bn/en strings per Q5; Rasel checks the Bangla.
- **Page guards** after `requireAccess()` and before any data call. The home page takes the name from the session and shows only live sections, with slots for payments' registration card and book card.
- **"Soon" comes only from the table, never from an API answer:**
  - there is no try/catch around data calls, and a 404, 5xx or timeout never turns into "soon";
  - methods that are not wired still throw, so a page that forgets its guard fails CI;
  - with the API down, the error page still shows.
- **Tests:**
  - every route has a table entry, and no entry is orphaned;
  - production `isLive` equals the table;
  - `?mock=launch` previews the production view in development.
- **`check-pages`** reads the table:
  - prod: a "soon" page must show the marker with HTTP 200, and a "live" page must not show the error state;
  - `api-down` keeps one "soon" page and still expects the error page there.

| Page | 15 Nov | Turned live by |
|---|---|---|
| `/dashboard` | name from the session; registration and payment card; free-book card; other blocks hidden | payments (steps 11, 16) |
| `/dashboard/book`; payments' admin pages (lookup, fee, book) | live when merged | payments |
| `/dashboard/exam`, `/dashboard/leaderboard`, `/admin/exams`, `/admin/exams/[id]`, `/admin/leaderboard` | coming soon | exam (E4/E5); the owner may keep them "soon" until the schedule is announced |
| `/dashboard/profile`, `/dashboard/profile/edit`, `/dashboard/announcements`, `/dashboard/ambassador`, `/admin/users`, `/admin/announcements`, `/admin/ambassadors` | coming soon | core |
| `/admin` | coming soon (the jury placeholder stays), unless Q5 asks for live numbers | — |

**Waits for the VPS.** One pass after the first deploy, as a real student (from the real payment) and as the first admin: every page shows real data or "coming soon", never the error page.

## 9. Session and token cleanup job

**Today.**
- There is no cleanup. `sessions` gains a row at every login and refresh and keeps minors' IPs and browsers; `auth_tokens` keeps expired tokens. Neither has an index on `expires_at`.
- The worker has no database client on `main`; exam PR #19 adds one.
- The recorded rule (DECISIONS A2.1b #9: delete rows that expired or were revoked more than 30 days ago) would also delete retired rows of families that are still alive. That would switch off refresh-reuse detection for a victim who comes back after about 5 weeks.

**Now, L13 (1.5–2 h).**
- **Schedule:** a nightly BullMQ job scheduler in the worker at 03:30 Asia/Dhaka: one job per tick, 3 attempts, failed jobs kept 7 days.
- **Sessions, per family:** a row goes when both its own expiry and its family's newest expiry are more than 30 days old. A family with any usable token is never touched.
- **Tokens:** deleted 7 days after expiry.
- **How it deletes:** batches of 1,000 under the 10 s statement timeout, a capped number of batches per run, and one log line and one audit row with counts only.
- **Never touched:** `audit_logs`, `payment_events`, `submissions`, payments, registrations, users, attempts.
- **An index migration:** `sessions(expires_at)`; `sessions(family_id, expires_at)` replacing `family_id`; `auth_tokens(expires_at)`.
- **Tests:**
  - a family 31 days past its newest expiry is deleted, and one 29 days past is kept;
  - a live family's 40-day-old retired token still triggers reuse detection;
  - the batch limits hold;
  - a second run deletes nothing, and two runs in parallel do not fail;
  - the append-only counts are unchanged, and two inits give one scheduler;
  - mutation checks on the family condition, the cutoff and the batch limit.
- Payments' D6 payload scrub (abandoned attempts after 30 days) can join this job if the payments session agrees. Its first rows fall due around 15 Dec.

**Waits for the VPS.** Only the first night's log line. Nothing ages out before mid-December, so if the schedule slips, this PR can follow the launch without harm.

## 10. Owner questions

Each question has a default; the work goes ahead on the default until Rasel answers.

1. **Backups: where, how often, how long, and who holds the key?**
   Default:
   - **Where:** an S3 bucket in the AWS account used for SES (ap-south-1), with versioning and lifecycle rules; a put-only key on the VPS, and a read-only key with Rasel for drills.
   - **How often and how long:** hourly encrypted dumps while registration is open, so at most 1 h is lost; 48 hourly + 7 daily + 4 weekly copies, about 35 days (the privacy page says so).
   - **Key holders:** two, Rasel and one person he names; never on the VPS, in git or in chat.
   - **Drills:** on Rasel's encrypted PC or a short-lived server, with payments off and email going to Mailpit, wiped afterwards.

   Cost: well under 1 USD a month (estimate). If the AWS account is late: Cloudflare R2, with the same script.
2. **Alerts: which outside service, who gets them, and separate caps?**
   Default:
   - **Service:** the free tier of an outside uptime and heartbeat service (for example Better Stack, or UptimeRobot with Healthchecks.io; terms checked first). Checks every 3–5 min for the registration launch; a flat paid plan with 1-minute checks before the first exam day (RULEBOOK §12).
   - **Who:** Rasel and one backup person, by email and Telegram or the service's phone app. `SECURITY_ALERT_EMAIL` is a group address for both.
   - **Caps:** security, payments and ops alerts get their own cap of 6 emails an hour each (today one shared cap of 6).
   - **Response:** best effort outside exam days (OPEN-QUESTIONS #23).
3. **Domain and Cloudflare: whose account, which hostname, and may HSTS cover the client's other subdomains?**
   Default:
   - **Account:** the whole zone in a client-owned Cloudflare Free account, with nameservers at Cloudflare; Rasel invited as administrator with 2FA.
   - **Hostname:** the site on the apex, `www` redirecting to it.
   - **TLS:** Full (strict) with an Origin CA certificate; Bot Fight Mode off.
   - **HSTS:** no `includeSubDomains`, no preload. It starts at 300 s and rises to 1 day, then 180 days, after stable weeks.
4. **Production access and deploys.**
   Default:
   - **Access:** a non-root `deploy` user with SSH keys for Rasel and one named backup person; root login and passwords off.
   - **Deploys:** run by Rasel, or by the lead session while Rasel watches. Sessions never read the VPS `.env`. A read-only GitHub deploy key on the VPS, plus a read-only token so `deploy.sh` can check CI for the exact commit.
   - **Images:** built on the VPS from the commit CI passed, with SHA tags for rollback. RULEBOOK §14 has the deploy script build, while §18 says "CI deploys a build artifact"; a registry would cost money, so a CI-built artifact comes after launch (a DECISIONS entry).
   - **Freeze:** 48 h, from Fri 13 Nov 00:00 (RULEBOOK §13). After launch, deploys run between 00:00 and 07:00 Asia/Dhaka.
   - **Admin accounts without 2FA at launch** (RULEBOOK §5: "recommended before launch"): at most two, created with the CLI, with long unique passwords in a password manager. 2FA is the first PR after launch.
5. **What students and admins see at launch.**
   Default:
   - **"Coming soon":** neutral text without dates. bn "শীঘ্রই আসছে। এই অংশটি পরে চালু হবে। এখন আপনাকে কিছু করতে হবে না।", en "Coming soon. This section opens later. You do not need to do anything now."
   - **Menus:** items stay visible and lead to that page.
   - **Maintenance page:** a generic bn/en "we'll be right back" with the "your payment is safe" line, and no contact details until the client gives one.
   - **Admin home numbers** (registered, paid, pending): "coming soon". Core's students list and payments' lookup cover the need; live numbers would be one small API PR, about 2 h.

## 11. Defaults for the lead

These are technical choices. Each is recorded in DECISIONS with the PR that needs it.
- Cloudflare Origin CA with Full (strict). No Cloudflare Tunnel. Authenticated Origin Pulls after launch. A Let's Encrypt fallback is only documented.
- The real client IP comes only from `CF-Connecting-IP` with Cloudflare's ranges, never from Docker ranges in production.
- Maintenance lets the PayStation IPN through.
- No per-IP `limit_conn`: RULEBOOK §11 lists `limit_req` / `limit_conn`, `limit_req` covers it, and a connection cap would refuse a school.
- The login limiter's 100 failures per minute per IP stays for launch (owner rule), since logins after payment are spread out. Revisit before the first exam with k6 data.
- Dumps, not WAL archiving, for launch. WAL after launch, never in the last week before it.
- After a restore everyone logs in again.
- Runtime role `sirat_app`; the bootstrap superuser stays owner and migrator. A non-superuser owner can come later.
- The cleanup's per-family rule replaces the wording of DECISIONS A2.1b #9. No job ever purges the audit or payment-event logs.
- No Sentry and no Cloudflare Turnstile at launch.
- Deploys accept the 10–20 s gap at launch (off-peak, behind the maintenance page). Zero-downtime switching comes after launch.

## 12. Schedule at the measured pace

**Measured on 31 Oct (GitHub timestamps):**
- Medium PRs took 1.3–2.0 h from the first commit to the merge: A2 #15 2.0 h and #20 1.3 h; exam #16 1.9 h and #17 1.6 h.
- Bigger ones took 3.9 h (#14) and 5.5 h (#12, which waited on #10).
- PRs merged 5–60 min after they opened, once CI was green and the lead had reviewed them.
- Three sessions made 48 commits (merges not counted) on 30 Oct and 110 on 31 Oct.

The table assumes about 2 h per medium PR, review rounds included. These are estimates, not commitments.

| Day | A2 (estimate) | Outside (owner, client, others) |
|---|---|---|
| Sun 1 Nov | L1 coming soon, L2 role and grants, L3 TLS-ready nginx and logs | Rasel answers Q1–Q5 (defaults apply meanwhile) |
| Mon 2 Nov | L4 real IPs and shared IPs, L5 maintenance, L6 backups | Domain: Cloudflare zone, SES domain identity, production access requested |
| Tue 3 Nov | L7 restore and drill, L8 role switch (stack window), L9 `deploy.sh` (start) | Bucket and keys; outside monitor account |
| Wed 4 Nov | L9 (finish), L10 alert categories | Domain at the latest |
| Thu 5 Nov | L11 `ops-check` and `monitor.sh`, L12 bootstrap (start) | Payments' web PRs (steps 10–11) build on L1 |
| Fri 6 Nov | L12 bootstrap, prelaunch-check, RUNBOOK §9; L13 cleanup | Sandbox session with Rasel (payments) |
| Sat 7 Nov | VPS with Rasel: bootstrap and first deploy (3–4 h); certificate, Cloudflare, firewall, scan (2–3 h) | VPS target |
| Sun 8 – Mon 9 Nov | On the VPS: rehearsals (about 2 h); backup timers, first copy, failure alert (about 1 h); monitors and the fake-alert drill (1.5–2 h); real-IP check on the three operators (about 1 h) | |
| Tue 10 – Wed 11 Nov | Restore drill 1 on another machine (1–1.5 h) | VPS at the latest (Tue 10); live merchant; real payment; k6 on the VPS (payments) |
| Thu 12 Nov | Final release candidate deployed; `prelaunch-check.sh` all PASS | Live merchant at the latest |
| Fri 13 Nov | Freeze from 00:00; restore drill 2 (T-2) | SES at the latest |
| Sat 14 Nov | Go/no-go (Rasel) | |
| Sun 15 Nov | Registration opens through the audited admin setting | |

- **One session:** the code is ready by Fri 6 Nov, before the VPS. If the lead gives L6–L7 and L10–L11 to a second session (their files barely overlap), by about Wed 4 Nov.
- **Domain on Wed 4 Nov:** no code waits; only SES and the Cloudflare zone move.
- **VPS on Tue 10 Nov:** the VPS work of 7–9 Nov moves into 10–12 Nov, next to the live switch and k6, with no slack left (section 14).

**Does not compress (kept apart from the estimates):**
- the domain, then Cloudflare activation (minutes to 48 h; days for a .bd domain);
- SES DKIM verification (hours) and production access (an AWS review that can take days);
- the VPS delivery (7 Nov, latest 10 Nov);
- sessions with Rasel present: bootstrap and first deploy 3–4 h; TLS and firewall 2–3 h; drills 1.5–2 h; each restore drill 1–1.5 h with a key holder;
- owner accounts: bucket and keys 30–60 min; the monitor service about 30 min; age keys offline 15–30 min;
- phone checks on the three mobile operators and IPv6 (about 1 h, with people on those networks);
- a `main` CI run before each deploy (20–30 min);
- the lead's review of each PR, and the shared-stack turns (one session at a time);
- the 48 h freeze;
- the HSTS ramp after launch (days to weeks; not on the launch path).

## 13. Shared files, stack turns and merge order

- **Files other sessions also change:**
  - `(student)/dashboard/page.tsx` and `apps/web/src/data/*` (payments steps 10–11 and 16, exam E4/E5): L1 lands first.
  - `security-alerts.service.ts` (payments' alert kinds): L10 merges after payments PR 2.
  - `worker.ts` (exam #19, payments PR 3) and the migrations (L2, L13): run `git merge origin/main`, keep both sides, and regenerate a generated migration per `PAYMENTS-PLAN.md` §12.
  - Also `infra/docker-compose.yml`, `ci.yml`, both `.env.example` files, RUNBOOK, 05-DATABASE and 06-API.
  - Only this plan changes `nginx.conf`: L3, then L4, then L5. DECISIONS merges as a union.
- **Shared stack:** each of these PRs needs a turn, asked for first, announced in one line and released after:
  - L1: web smoke and e2e;
  - L3–L5: nginx;
  - L7: one read-only dump of the dev database;
  - L8: it recreates PgBouncer and changes every worktree's `DATABASE_URL`, so it needs one window with Rasel.

  L9's rehearsal and the L6–L7 tests run in their own compose projects with their own ports; they are announced because they share CPU and RAM.
- **Every PR follows the usual rules:** contract or decision first; tests and mutation checks; the full pre-PR checks; a description ending "Ready to merge: <sha>".

## 14. Risks

1. **A late VPS** (after Tue 10 Nov): rehearsals, drills, k6 and the real payment would squeeze into the last two days. Mitigation: everything is rehearsed locally first (the L9 rehearsal, the L7 drill, `prelaunch-check --local`), and the VPS day follows a written script.
2. **Shared IPs:** one school or operator IP can still hit nginx or API limits during the registration surge. Mitigation: L4 and payments' tiers; final numbers from k6 with simulated shared IPs; the access log shows who got a 429.
3. **A silently broken real-IP restore** (an AAAA record or IPv6 listener, a stale Cloudflare list, a Cloudflare setting): everyone shares one bucket. Mitigation: IPv4-only bindings, the Cloudflare checklist, and the access-log check on day one in `prelaunch-check.sh`.
4. **No SES keys means no confirmed payments:** the worker will not start without a usable email configuration, and it confirms payments. Mitigation: the IAM keys go into `.env` before opening, even if production access is pending; it is a checklist item.
5. **Restores:** a lost decryption key makes every copy useless, and a restore older than the newest payments needs a manual match against a PayStation export. Mitigation: two key holders, tested at every drill; hourly dumps; the after-restore steps in `restore.sh`.
6. **Helmet's HSTS** (1 year, `includeSubDomains`) would go out with the first HTTPS response and cannot be recalled. Mitigation: L3 turns it off before TLS exists.
7. **Docker bypasses UFW:** the server can look firewalled when it is not. Mitigation: the provider firewall or DOCKER-USER rules, and an outside port scan on the checklist.
