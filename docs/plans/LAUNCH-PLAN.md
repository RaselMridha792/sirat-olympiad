# Launch readiness: plan (first release, 15 November 2026)

Plan only, no product code (2026-10-31, branch `feat/a2-launch-plan`, A2 session). It reaches `main` in a docs-only pull request that the lead reviews and merges. No code starts before that review.

**Launch:** registration and payment only (Lead, 2026-10-31). A student registers, pays, logs in and sees their own registration and payment status. All times below are estimates at the measured pace (section 12), not promises.

Sources: RULEBOOK §3, §5, §6, §9, §11–§14, §18; RUNBOOK §2–§5, §7, §9, §10, §12, §13; `plans/PAYMENTS-PLAN.md` §10, §13, §16; `plans/EXAM-PLAN.md`; `plans/CORE-PLAN.md`; DECISIONS (A1 approval, A2.1b, A2.1e, "Per-user API limits", "Registration start and status", "Web data layer over HTTP", "Public entry page and legal pages"); OPEN-QUESTIONS #17, #18, #22, #23, #27. Six read-only passes over `main` at aef64c9 (deploy, TLS, backups, DB role and cleanup, monitoring, dashboards) established today's state. An independent review then checked every claim again against `main` at a6876ec, after #19, #21, #22, #23 and #25 had merged, and a second review at f952ade, after #24 and #26; #27 merged after that and is reflected below. `main` moves several times a day: the lead re-reads the "Today" lines at review.

## 0. Scope, dependencies and dates

- **This plan (A2):** the eight areas the lead listed on 2026-10-31 (22:26), the email (SES) items of the checklist, and nginx logs without query strings (Lead, 22:58).
- **Other sessions:**
  - **payments:** the money flow is merged (PR 3, #27: verify job, settle, callback, IPN, reconciliation, admin payments and settings). Still to come: the wizard and the dashboard status (PR 4), the PayStation live switch, the real payment, the k6 registration surge and the free book (`PAYMENTS-PLAN.md` §10.4, §13). The per-IP tiers of `/registrations/*` were set in #21 (DECISIONS "Registration start and status" #6); section 3 shows how they sit against nginx.
  - **exam:** the student exam list (`GET /exams`, #23) and the exam room (`GET /exams/:id`, E4, #24) are on `main`. The leaderboard and admin exam pages come with E5 and say "coming soon" until then (section 8).
  - **core:** the public entry page and the privacy, terms and refund-policy pages are merged with placeholder texts (#25), and so is the admin students list (C1, #26). Planned before 15 Nov: the profile (C3), announcements together with the student dashboard home (C4, composed in the web from existing endpoints, so `GET /dashboard/home` is dropped: CORE-PLAN D6) and ambassador approval (C5a).
    - PayStation's live review needs these pages live on the client's domain with the client's texts (CORE-PLAN Q5 and risk 2). They go live with the first VPS deploy and TLS (Sat 7). `PAYMENTS-PLAN.md` §10.2 lists only the domain for the live merchant; the lead aligns the two plans.
    - The privacy page should state the backup retention that Q1 settles (section 10).
- **Outside dates** (`PAYMENTS-PLAN.md` §10.2): domain Mon 2 Nov (latest Wed 4); VPS Sat 7 Nov (latest Tue 10); live merchant Tue 10 (latest Thu 12); SES production access requested the day the domain arrives, granted by Wed 11 (latest Fri 13).
- **Rules throughout:** no deploy during a live exam window (`deploy.sh` refuses one, section 2); nothing secret in git, logs or messages; the shared stack only with the lead's or Rasel's go-ahead.

## 1. Summary

| § | Area | Now, without the VPS | Waits for the domain or the VPS | PRs (estimate) |
|---|---|---|---|---|
| 2 | Deploy and rollback | SHA-tagged images and a release file; `deploy.sh` (an explicit project, a first start, preflight, migrate first, smoke, automatic rollback without a build); `bootstrap.sh`; a rehearsal in a throwaway VM (Q4) or its own compose project | bootstrap, first start and first deploy; deploy, second deploy, forced rollback and reboot rehearsed on the VPS | L9 3.5–4.5 h; L12 (part) |
| 3 | TLS, real IPs, logs | 443 for Cloudflare Full (strict); HSTS and a page CSP from nginx; `no-store` on `/api`; logs without query strings or Referer; an internal listener for checks from the server; a real-IP test harness; zones and tiers sized for shared IPs | Origin CA certificate, Cloudflare settings, firewall, real-IP check on the mobile networks | L3 3–3.5 h; L4 2–2.5 h |
| 4 | Backups | encrypted dumps shipped off-server (a local remote in tests); restore into an empty database on a fresh cluster; an isolated, scripted drill, run locally and in CI | bucket and keys (owner); timers on the VPS; drills from a real VPS copy on another machine | L6 2 h; L7 2.5–3 h |
| 5 | Runtime DB role | role, grants, boot line, the app tested as the role; then the switch | the first VPS deploy starts with the role | L2 2–2.5 h; L8 1–1.5 h |
| 6 | Monitoring | alert categories with their own caps; `ops-check`; `monitor.sh` (host, CPU and memory, web render errors); a heartbeat that fails on any critical state; a daily digest | outside monitors on the domain; cron on the VPS; fake-alert drill | L10 2 h; L11 4 h (the digest included) |
| 7 | Maintenance, checklist | maintenance switch (503 page, the IPN still passes); `prelaunch-check.sh`; RUNBOOK §9 as T-7 → T-0 | switch tested through Cloudflare; checklist on the VPS; go/no-go | L5 2 h; L12 (part) |
| 8 | "Coming soon" | a launch table, `ComingSoon`, guards for pages whose data is not wired by launch, per-page CI expectations | one pass on the server as a real student and admin | L1 1.5–2 h |
| 9 | Cleanup job | session and token purge (DECISIONS A2.1b #9), indexes, a nightly job in the worker | first run on the VPS | L13 1.5 h |
| — | VPS tuning | — | limits retuned before the data services first start, if the specs differ; zones, tiers and thresholds after k6 | L14 1–2 h |

L12 is `bootstrap.sh` + `prelaunch-check.sh` + RUNBOOK §9 (4–5 h). In all: 14 PRs, about 35 session-hours.

## 2. Deploy and rollback

**Today.**
- RUNBOOK §2 is a manual list, never run on a VPS.
- Compose gives images no tag, so each build overwrites `:latest`, and a rollback means rebuilding the old commit: slow, and it needs npm and Docker Hub during an incident.
- A plain `up -d`, and also `run` without `--no-deps`, can recreate data services. Nothing enforces "green CI only" or "no deploy in an exam window".
- `bootstrap.sh` only prints its steps.
- Each deploy leaves 10–20 s with no API, because all replicas restart (RUNBOOK §2).

**Now, L9 (3.5–4.5 h).**
- **Images:** compose sets `image: sirat-<service>:${SIRAT_TAG:-latest}`, so CI and local runs keep `latest`.
- **The live release:** `deploy.sh` writes `SIRAT_TAG=<sha>` to a release file outside the repo (`/var/lib/sirat/release.env`); `--rollback` writes the previous one. The VPS `$DC` reads it as a second `--env-file`, and every `up` on the VPS uses `--no-build`. So the RUNBOOK's scale, worker, selfcheck and create-admin commands run the live release and never start a build. L9 updates those RUNBOOK lines (§3, §5, §7, §9, §10, §12, §13).
- **The project is always explicit:** every script that calls compose (`deploy.sh`, `backup.sh`, `restore.sh`, `restore-drill.sh`, `prelaunch-check.sh`) passes `-p <project>`. The compose file pins `name: sirat`, so a second clone alone is no isolation.
- **First start, `deploy.sh --first`,** once on a fresh host (the VPS, and the rehearsal's release A):
  - it refuses if any data container of the project already exists, so it can never recreate one;
  - it needs a filled `.env`, the certificate in `infra/nginx/certs`, and L14 part 1 merged if the specs differ;
  - it runs `up -d --no-build --wait postgres pgbouncer redis-cache redis-queue`, then `up -d --no-deps --no-build nginx` (nginx's `resolve` upstreams let it start before web and api exist);
  - the first deploy that follows has no previous release: it treats a database without an `exams` table as "no exam window", and on failure it stops with maintenance on instead of rolling back.
- **`scripts/deploy.sh <sha>`:**
  1. **Preflight:**
     - a lock; not root; `.env` mode 600; a clean tree;
     - exported `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_*` and `COMPOSE_*` unset;
     - the target refused if its Postgres carries the development marker (the shared dev stack);
     - free disk;
     - the SHA is on `origin/main` and its CI run passed. **Rehearsal mode** (refused for project `sirat`) accepts a commit of the rehearsal branch instead, and says so in its first output line; production always keeps the CI gate;
     - no exam window open within ±30 min (psql inside the postgres container, as `backup.sh` does);
     - data services healthy and unchanged. Each data container's compose config hash must match the file; a mismatch stops with "data-service change pending: apply it as its own step". A deploy never starts or recreates data services.
  2. Build the tagged images while the old release serves.
  3. Take a backup first when the release adds migrations: `sudo -n systemctl start sirat-backup.service`, the root-owned unit the backup timer also starts (one sudo rule from `bootstrap.sh`, checked with `visudo -cf`). A failed backup stops the deploy before migrate, and the old release keeps serving.
  4. `run --rm --no-deps migrate`. It must print `config seed done`; on failure the script stops and the old API keeps serving.
  5. `up -d --no-deps --no-build --wait api worker web`. nginx is reloaded only when `infra/nginx` changed.
  6. **Smoke:**
     - through nginx's internal listener (section 3): exact 200s with the expected body (`curl -f` passes a 301);
     - through the public URL, after reading `maintenance.sh status`: with the flag off, the same exact 200s; with the flag on (the kill switches, or a critical fix during an incident), the maintenance answers (`/healthz` 200, `/api/ready` 503 `code: MAINTENANCE`), and the script says the public app check waits for maintenance off;
     - each new API replica's PayStation boot line matches the release's `.env` (read, never printed): with `PAYSTATION_ENV` set, `env=<that value>` with the `.env`'s account label, invoice prefix and https callback and IPN; with it blank, "PayStation disabled" and the "payments are DISABLED" warning, which passes only while `registration_open` is false (psql, as the exam-window check). So deploys before the live switch pass. The `env=live` rule is `prelaunch-check.sh`'s (section 7);
     - the worker healthy; `migrate status` up to date.
  7. **Success:** record the release and keep the last 3 image sets (never volumes). **Failure:** roll back to the previous tag with no build, smoke again, and print loudly that migrations stay applied. `deploy.sh --rollback` does the same by hand.
- **RUNBOOK:** §2 rewritten around the script. Every `run --rm migrate` gets `--no-deps`. The lead's dev rule (`$DCD up -d --build --no-deps migrate api worker web nginx`) goes into §0.
- **Rehearsal without the VPS,** in rehearsal mode as project `sirat-rh`: in the throwaway Ubuntu VM that also tests `bootstrap.sh` (its own Docker daemon and real file modes; Q4), or else in its own clone. Its settings: nginx on 127.0.0.1:18080/18443, no data ports, throwaway secrets, a self-signed certificate, and a release file outside the clone. Commands run by hand use the rehearsal's own `$DC` (`docker compose -p sirat-rh --env-file .env --env-file <its release file> -f infra/docker-compose.yml`), never the dev shell's; before step 3, `$DC ps` must list only `sirat-rh` containers. The steps, each checked for its own stop reason:
  1. first start, then release A;
  2. release B with a migration, under a request loop;
  3. the RUNBOOK's scale, create-admin and worker commands, exactly as written apart from `$DC`: every container runs `sirat-*:<B>`, and no build starts;
  4. a commit whose API fails at boot: the script rolls back by itself, timed; the same commands then give A;
  5. a failing migration: the migrate log shows it, and no app container restarted;
  6. a release that changes PgBouncer's pool size: the exact message "data-service change pending";
  7. maintenance on and off, checked through the internal listener;
  8. maintenance on, then `deploy.sh --rollback`: success through the internal listener, the public check named as pending; then maintenance off, and the public smoke passes.

  One extra run without rehearsal mode: the step-4 commit is refused as "not on origin/main", which exercises the CI gate. The data containers' start times must not change. Outside a VM it shares CPU, RAM and the image store with the shared stack: SIRAT_TAG is always set, only its own `<sha>` tags are pruned, and it is announced.
- **`bootstrap.sh`** (in L12): idempotent, with `--dry-run` and shellcheck in CI. For Ubuntu 24.04 it sets up:
  - Docker at the versions CI uses;
  - a `deploy` user, SSH keys only, no root login;
  - the firewall in the provider panel or as DOCKER-USER rules, because UFW does not filter Docker-published ports;
  - fail2ban, chrony, security updates without automatic reboot, swap, `vm.overcommit_memory=1`;
  - a clone with a read-only deploy key, and the release file;
  - `.env` from the example at mode 600, for the owner to type the secrets into;
  - the backup and monitor timers, the root-owned `sirat-backup.service`, and the one sudo rule that lets `deploy` start it.

  It is tested in the throwaway VM (Q4) and timed against the 1-hour rebuild target (RULEBOOK §3). Without a VM, its first full run is on the VPS on Sat 7.

**Waits for the VPS,** in this order on Sat 7:
1. The specs confirmed (OPEN-QUESTIONS #22). Postgres and the compose limits assume 8 vCPU and 32 GB; a smaller box gets L14 part 1 first (section 12).
2. bootstrap run and timed; the owner types the secrets.
3. The Origin CA key and certificate (section 3).
4. First start.
5. Cloudflare (Full (strict) only after the certificate) and the firewall.
6. The first deploy on an empty database; the first admins created with the CLI (RUNBOOK §13); the outside scan.

Then: deploy, second deploy, forced rollback and a reboot, rehearsed and timed.

**Known limit at launch:** the 10–20 s gap per deploy stays. That departs from RULEBOOK §14 (new containers first, then switch traffic), so it is owner question Q4. Deploys happen off-peak, and with L5 the gap shows the maintenance page instead of a raw 502.

## 3. TLS behind Cloudflare, real client IPs, shared IPs, logs

**Today.**
- nginx listens on 80 only; 443, HSTS and a page CSP are TODOs. Compose publishes 80 and 443 on every interface, and `infra/nginx/certs/` has no tracked file. Cloudflare could only use Flexible mode, which is plain text between Cloudflare and the server.
- The real-IP restore is in place and correct: `cloudflare-realip.conf` trusts only Cloudflare's ranges and reads `CF-Connecting-IP`, and the API takes nginx's restored address (`trust proxy 1`).
- The API's helmet sends HSTS for 1 year with `includeSubDomains` by default. That would bind every subdomain of the client's domain the moment HTTPS works.
- Pages get only `frame-ancestors 'none'` (Next config); no Content-Security-Policy (RULEBOOK §11 asks for one).
- nginx writes the default `combined` access log: the full request line and the Referer, query strings included.

**Now, L3 "TLS-ready nginx" (3–3.5 h).**
- **Config:** nginx.conf is split into http-level settings, an `app-locations.conf` include (today's locations, unchanged) and one site file.
  - The production site is a template filled from the public host. Port 80 answers `/healthz` and redirects everything else to https. A default 443 server refuses unknown names at the handshake. The real 443 server has HTTP/2, TLS 1.2/1.3 and the Cloudflare Origin CA certificate.
  - The dev and CI site file stays plain http on 8080, so e2e and the smoke test do not change.
  - **An internal listener for checks from the server:** `listen 127.0.0.1:8081` in an include that both site files load. It serves `app-locations.conf` with no https redirect and no maintenance switch, and it is never published: `$DC exec -T nginx wget -qO- http://127.0.0.1:8081/api/ready`. The public servers make no exception for any client address.
- Directory mounts instead of single-file mounts. Ports bound to IPv4 only: with no IPv6 listener, Docker never replaces the client address. Add `certs/.gitkeep`.
- **Headers,** in one include that also serves the `@api_*` error locations and nginx's own pages:
  - nosniff, Referrer-Policy, and HSTS. HSTS comes only from nginx: helmet's is turned off, and an API test checks it.
  - **Page CSP**, a fixed policy (nonces would make every Next page dynamic): `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. L3 adds a `securitypolicyviolation` listener to the shared CDP driver (`apps/web/scripts/lib/cdp.mjs`), so every browser script built on it fails on a violation: `e2e.mjs` and `e2e-exam.mjs` now (login, refresh, the dashboards, the exam room), payments' wizard e2e later. The dev and CI site file sends the same policy as Report-Only, which fires the same event. On the VPS the policy stays Report-Only until payments' wizard e2e (PR 4/5, with the fake PayStation service) has passed with it, from the wizard to the fake gateway's `paymentUrl` and back to the result page. Then it is enforced, at the latest in the Thu 12 release candidate; if that e2e is late, A2 runs it against the rehearsal once PR 4 merges. A nonce- or hash-based `script-src` comes after launch (a DECISIONS entry).
  - `Cache-Control: no-store` on `/api`.
- **Logs (Lead, 22:58):**
  - One explicit access-log format, with every field listed. The path is cut at the first `?` (a `map` on `$request_uri`), and the Referer is dropped. No raw `$request`, `$request_uri` or `$http_referer`.
  - So search terms, for example from core's `/admin/users?q=<name or phone>`, never reach a log: not in the request line, and not in the Referer that the browser sends from that page under `strict-origin-when-cross-origin`.
  - The log adds request time, upstream status and the Cloudflare edge address.
  - nginx's error log also writes the full request line and the referrer, so it runs at `crit`. 429s and upstream errors then appear only in the access log.
  - **Test:** one request with a random `?q=` value and a `Referer` carrying a second random `?q=` value; neither may appear in `docker logs nginx`. The L4 harness also forces an error-level event (a 429 and a stopped upstream). Mutation checks: putting back `combined` or `$http_referer`, or removing `crit`, fails the test.
  - The API already logs paths without query strings.
- `APP_URL` must be https in production unless its host is local. `nginx -t` runs both site files with a throwaway certificate, in CI and in `refresh-cloudflare-ips.sh`.

**Now, L4 "real IPs and shared IPs" (2–2.5 h, after L3).**
- **Built** (DECISIONS "Real IPs and shared IPs"): the /64 key, the raised zones, the API tiers, `scripts/loadtest-generators.sh` and `infra/nginx/test/check-real-ips.sh`.
- **Test harness:** its own Docker network, stub upstreams and a fake "Cloudflare" peer; no shared stack and no fixed ports. It runs in the CI docker job and checks that:
  - the restore works from a trusted peer, and a spoofed header from anyone else is ignored;
  - one IP's 429 does not touch another IP;
  - two IPv6 addresses in one /64 share a bucket;
  - TLS sends exactly one HSTS header, and an unknown name is refused;
  - http redirects, and `/healthz` answers 200 on 80;
  - the internal listener cannot be reached from the fake peer.
- **Shared IPs** (school labs, mobile carrier-grade NAT). After the restore there is one bucket per real IP: precise for broadband and IPv6, coarse for a school or an operator IP. Today, all students behind one such IP share:
  - nginx `auth` 20 r/s (burst 200) and `api` 30 r/s (burst 60, about 1,800 a minute). The `api` zone covers every signed-in call and the registration poll, so today it refuses the poll before the API's own 3,000 a minute does;
  - the API's 600 per minute per IP for other anonymous calls;
  - the registration tiers from #21: start and retry 300 per minute per IP; info, current, resume and cancel 3,000; plus 10 an hour per email and per phone;
  - the login limiter's 100 failures per minute per IP (owner rule).
- **L4 changes:**
  - the zones are keyed per IPv4 address or per IPv6 /64;
  - they rise to `auth` 100 r/s (burst 1,000) and `api` 200 r/s (burst 2,000), the proposal in DECISIONS "Per-user API limits";
  - each A2 per-IP tier gets a decision, and that DECISIONS line is amended to match: refresh rises to at least the api zone's rate per minute (12,000); the 600 default stays, because it covers only anonymous calls (a signed-in call counts per user, and the registration routes have their own tiers); forgot-password 120 and the email links 300 stay on purpose, for email volume, until the global link-email cap below the SES quota exists;
  - no per-IP `limit_conn`, since it would refuse a school.

  After L4, the API's 3,000 a minute is the poll's limit again (about 100 students polling every 2 s behind one IP). Payments re-checks its tiers against the new zone, with numbers from k6 (L14).
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
- k6 with simulated shared IPs, and the numbers recorded in DECISIONS (L14).

## 4. Backups and a restore drill

**Today.**
- `backup.sh` writes a verified local dump, marked "NOT yet off-server". `restore.sh` restores over the live schema with `--clean` and was never rehearsed end to end.
- There is no schedule, encryption, retention, alert or off-server copy. RULEBOOK §6 wants nightly copies off the server, 7 daily + 4 weekly, an alert on failure and a drill on another machine.
- **Silent gaps:**
  - A restore into a fresh database drops the database-level timeouts (10 s / 5 s / 60 s). `pg_restore` applies them only with `--create`, and the migration that set them is already marked applied.
  - A restore over a schema that has a later migration breaks the migrate job.
  - Once L2 exists, a dump carries grants to `sirat_app`, but roles live outside the dump. On a fresh cluster the restore fails unless the role exists first.

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

**Now, L7 "restore into an empty database, scripted drill" (2.5–3 h).**
- **`restore.sh`, two modes:**
  - **Rebuild:** first make sure `sirat_app` exists (NOLOGIN, no password: a `--ensure` mode of L2's `runtime-role.ts`), then restore into an empty database on a fresh volume, with no `--clean`. The timeouts are re-applied and checked, then migrate and start; the migrate job sets the role's login afterwards. This also fixes bootstrap's order.
  - **Server still up:** restore into `sirat_restore_<stamp>`, check it, stop traffic, swap the names, and keep the old database for payments newer than the dump.
- **Before it acts,** it prints the project, the database and the server marker, and asks for the project name to be typed. It refuses a server marked as development unless told otherwise, and it stops the worker too.
- **After a restore:**
  - the cache is flushed;
  - everyone logs in again, because session and token rows are not restored;
  - the JWT secret is rotated;
  - payments since the dump time minus 1 h are compared with a PayStation export.
- **`restore-drill.sh`:**
  1. download, and check the sha256 against the manifest;
  2. decrypt and restore into an isolated drill project (`sirat-drill`): its own volumes, throwaway secrets, payments off, email only to Mailpit, no published data ports, and nginx and the Mailpit page on 127.0.0.1 only. It refuses to start if compose shows any port bound beyond 127.0.0.1;
  3. check the migrations, counts and triggers, the grants (`has_table_privilege('sirat_app', …)` and the default privileges), `SHOW statement_timeout` = 10s, and that the audit log refuses a delete;
  4. one login as `sirat_app`;
  5. wipe: `down -v` only with `-p sirat-drill`, after checking the compose project label of each container; project `sirat` is refused. Then print the measured restore time.
- **CI round trip** in the docker job, into a fresh cluster (a second Postgres): create admin A, back up, create admin B, restore. A logs in (204), B does not (401), the counts and grants match, and the timeouts are back.
- **The local drill the lead asked for:** L7 runs it in its own compose project, with no shared stack. With the lead's go-ahead it runs once more on a read-only `pg_dump` of the shared dev database. The results and timings go in the PR.

**Waits for the owner or the VPS.**
- **Owner (Q1), any day before 7 Nov, no VPS needed:** the bucket with versioning and lifecycle rules (hourly copies 2 days, daily 8, weekly 35), a put-only key for the VPS and a read-only key for drills. The key holders make the age keys offline.
- **VPS:** the timers; the first copy seen in the bucket; a forced failure that reaches the owner.
- **Drills from a real VPS copy on another machine:**
  - before registration opens (about 10–11 Nov);
  - again at T-2 (13 Nov);
  - then weekly while registration is open.

  A short-lived drill server allows only SSH in its provider firewall and is destroyed after the wipe.
- WAL archiving (point-in-time recovery) only after launch.

## 5. Runtime DB role (OPEN-QUESTIONS #27)

**Today.** The API, the worker, the seed and the CLI connect as the bootstrap superuser, which also owns every table. So an injected statement could:
- disable the append-only triggers (`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role`);
- truncate tables;
- run shell commands (`COPY … TO PROGRAM`).

The superuser password also sits in every app container through `env_file`. The owner put the role on the pre-launch checklist (DECISIONS "A1 approval" #5, RUNBOOK §9).

**Now, L2 "role and grants" (2–2.5 h; nothing switches yet).**
- **A hand-written migration:**
  - creates `sirat_app` if missing (no superuser, createdb, createrole, replication or bypassrls), safe if two databases run it at the same moment;
  - grants CONNECT, USAGE and SELECT/INSERT/UPDATE/DELETE on the app tables;
  - grants only SELECT/INSERT on the append-only tables (those with an `*_append_only` trigger: `audit_logs`, `payment_events`, `point_ledger`, `submissions`), nothing on `_prisma_migrations`, and no temporary tables;
  - sets default privileges, so every future table gets the same DML.
- **`prisma/runtime-role.ts`**, run by the migrate job after `migrate deploy`:
  - sets the role's login and password with a SCRAM verifier computed locally, so the plaintext never reaches Postgres or its log;
  - manages only the fixed name `sirat_app`;
  - puts back a missing database timeout (a present one stays as a migration set it), which closes the restore gap of section 4;
  - has an `--ensure` mode for restores (section 4);
  - prints one line (plus a warning when it cleared role settings) and never a value.
- **A boot line** in the API and the worker: `database role=<name> superuser=<bool>`. In L2 it warns; after L8 production refuses to boot as a superuser.
- **Tests:**
  - the integration suite runs the app as `sirat_app` when `TEST_APP_DATABASE_URL` is set (A2 and CI set it), so a missing grant fails in CI, not in production;
  - a catalog test checks every table's privileges;
  - as `sirat_app`, each of these fails with 42501: TRUNCATE, DISABLE TRIGGER, `session_replication_role`, DDL, `COPY … TO PROGRAM`, reading `_prisma_migrations`, UPDATE/DELETE on the append-only tables;
  - mutation checks on the default privileges, the append-only REVOKE and the missing-timeout rule.
- **Keys, in L2:** the `sirat_app` password key in the root `.env.example` and in the migrate service's environment (optional until L8), and `TEST_APP_DATABASE_URL` in `apps/api/.env.example`.
- **The shared dev cluster:** roles belong to the whole Postgres cluster, so there is one `sirat_app` password for every session's databases.
  - On a cluster with the development marker, `runtime-role.ts` sets the password only while the role has none; with an empty key it skips that step with one line and never fails the migrate job. So stack turns from any worktree keep working after L2, and none can reset another's password. Without the marker (production, from L8), an empty key fails.
  - Rasel types the same value into the root `.env` of every worktree that takes stack turns, and into A2's `apps/api/.env` as `TEST_APP_DATABASE_URL`. The first announced stack turn after L2 merges (A2's) sets it.
  - Test preparation never changes it: it only logs in as `sirat_app` and stops with a clear message if that fails. CI's database job sets the role's password in its own Postgres before `test:int`.
  - Without `TEST_APP_DATABASE_URL`, a session's tests run the app as the superuser, as today; payments, exam and core each turn the key on when ready.

**Now, L8 "switch to the role" (1–1.5 h, before the first VPS deploy).**
- **Connections:**
  - PgBouncer knows only `sirat_app`;
  - `DATABASE_URL` uses it for the API, the worker, the seed and the CLI;
  - `DIRECT_URL` (the superuser) goes only to the migrate job;
  - the API and worker containers get the superuser variables blanked.
- **Also changes:** both `.env.example` files (`DATABASE_URL` as `sirat_app`, `DIRECT_URL` for migrate only); the CI docker job (migrate, seed and `/api/ready` through PgBouncer as `sirat_app`); `restore.sh` (section 4); 05-DATABASE; RUNBOOK.
- **On the shared dev stack** it needs one window that the lead and Rasel pick: PgBouncer is recreated, so the stack's pooled connections drop. Other worktrees connect straight to Postgres and keep working. A worktree moves its own `DATABASE_URL` to `sirat_app` only after it has merged L2 and migrated its own database; otherwise its API gets 42501 on every table. Sessions never read `.env`.

**Waits for the VPS.** The first deploy starts with the role, so there is never a live switch:
- the migrate log shows `runtime role ready`;
- the boot line shows `superuser=false`;
- `pg_stat_activity` shows only `sirat_app` for pooled connections.

## 6. Monitoring and alerts

**Today.**
- `/api/health` (liveness) and `/api/ready` (Postgres through PgBouncer, both Redis) exist, and every long-running service has a Docker healthcheck. `/api/ready` does not cover the worker.
- Alerts have one path. `SecurityAlerts` writes an audit row and a log line, then sends an email through the cache Redis, the queue Redis, the worker and SES. One cap of 6 emails an hour is shared by every kind (owner, DECISIONS A2.1e #6).
- Nothing watches from outside, and nothing checks disk, CPU, memory, queues or 5xx. `healthcheck.sh` treats a 3xx as success.
- A dashboard page that fails still streams with HTTP 200 (its `loading.tsx` boundary), and its reads go to the API inside the stack. So nginx's 5xx rate never sees a broken dashboard page.
- Docker never restarts a container that is only "unhealthy", and nginx keeps sending it traffic.

**For launch: two paths that do not depend on each other.**
- **Outside** (a free-tier uptime and heartbeat service, Q2):
  - checks `https://<domain>/api/ready` (by keyword, alerting after 2 failures) and `/` every 3–5 min (Q2: RULEBOOK §12 asks for every minute), plus certificate expiry;
  - two heartbeats. `backup.sh` pings after each verified upload and `/fail` on error. `monitor.sh` pings success only when no critical state is open; otherwise it pings `/fail` with the kind names only (no values). An `ops-check` that cannot run counts as critical too. While `deploy.sh` holds its lock, `monitor.sh` holds back `/fail`;
  - alerts by email and Telegram or its phone app.

  So the outside path sees the site, readiness, every critical state and a missing heartbeat, even when our Redis, worker, SES or the whole VPS is down. A stopped worker cannot email its own alert, and it is the only path that confirms payments, so this matters most.
- **Inside:**
  - `scripts/monitor.sh` runs from cron every 5 min. It collects host facts: disk, CPU (a `/proc/stat` sample), memory (from MemAvailable, so the page cache does not count), swap, containers, the last 5 min of nginx, API and web logs (5xx answers, and server render errors, which Next logs with a digest), backup age, certificate end date, time sync.
  - It passes them to an `ops-check` CLI in the API container, which adds queue counts, connected workers and failed jobs, Redis memory, and Postgres connections and locks.
  - The thresholds live in TypeScript. An alert fires only when a check changes state, then an hourly reminder, and one "resolved" line at the end.
  - A daily digest at 08:00 Asia/Dhaka (held-back alerts, backups, disk, payment counts) also proves each morning that email works.
- **Default thresholds** (tuned after k6 on the VPS, L14):
  - disk: warn at 80%, critical at 90%; any swap use warns;
  - CPU busy or memory in use above 85% on two runs warns (RULEBOOK §12); memory above 95% is critical;
  - containers: unhealthy or not running on two runs is critical;
  - queue Redis memory: warn at 300 MB, critical at 400 MB (of 512);
  - workers: zero on two runs is critical. More than 500 waiting jobs, or an oldest job older than 5 min, warns; a payments or email job waiting more than 15 min while workers are connected is critical (a stuck worker);
  - failed jobs: any job that failed for good since the last run warns, counted by finish time; for the payment verify job it is critical (RULEBOOK §9);
  - nginx 5xx above 2% warns (with at least 50 requests), above 10% is critical; web render errors or API 5xx in the last 5 min warn;
  - API p95 above 1 s warns;
  - certificate: under 14 days warns;
  - backups: the newest older than 26 h is critical.
- **Payment alerts** came with payments PR 3 (#27): money set aside for an admin raises the critical `payments.needs_review`, and warnings go to the audit log without email. `ops-check` adds only the generic part: the payments queue has workers, and the reconciliation job ran within 3 of its intervals.
- PgBouncer waiting clients, slow queries and lock metrics stay manual (RUNBOOK §7) until server metrics exist (Q2).

**PRs.**
- **L10 (2 h):**
  - alert categories (security, payments, ops), each with its own hourly cap (Q2), and the subject by category;
  - no "Account:" line when there is no account;
  - a production boot warning when `SECURITY_ALERT_EMAIL` is blank;
  - an `ops-alert` CLI with an allow-list of kinds.

  Every existing kind gets a category, including payments' `payments.needs_review` (#27). The category map is typed per kind, so a later kind without a category fails typecheck after `git merge origin/main`.
- **L11 (4 h):**
  - the `ops-check` CLI: table tests for every threshold, and int tests (a backlog with no worker, a failed job, a state change that alerts once);
  - `monitor.sh` with shell tests on faked commands: a critical state calls `/fail` and not the success ping; a clean run calls only the success ping; an `ops-check` that fails to run calls `/fail`;
  - `healthcheck.sh` and `monitor.sh` require exactly 200;
  - the daily digest: an 08:00 Asia/Dhaka cron line runs `ops-check --digest`, one email with the last 24 h of alerts by kind (from the audit log, so held-back ones are included), the backup age, disk and payment counts by status; a test checks that it sends once a day;
  - `monitor.sh --dry-run` in the CI docker job;
  - RUNBOOK §1/§7: copy-paste commands and an "alert → action" table.

**Waits for the domain or the VPS.**
- The outside checks, which need the domain and TLS.
- Real alert email: the SES domain identity, then production access. Until then the alert inbox is verified as an SES recipient.
- On the VPS: the cron lines (monitor and digest), and `.env.monitor` with the heartbeat URLs.
- The fake-alert drill with Rasel present, on both paths (RULEBOOK §13). A stopped worker, a stopped API and a lowered disk threshold must each raise an alert. The stopped-worker alert must arrive through the outside service while the worker is still stopped.

## 7. Maintenance page and the pre-launch checklist

**Today.** There is no maintenance mode: RUNBOOK §4 is a TODO, and RULEBOOK §14 requires one. During a web restart visitors get nginx's raw 502. The restore procedure stops nginx, so visitors get Cloudflare's "origin down", and it leaves the worker running.

**Now, L5 "maintenance mode" (2 h, after L4).**
- **The switch:** a flag file in a git-ignored folder, checked by nginx on every request, so no reload or restart is needed.
- **With the flag set,** every public location answers 503 except:
  - `/healthz`;
  - the PayStation IPN, which only records and queues; PayStation retries, and reconciliation catches anything missed.
- **Answers:** HTML for pages and for the PayStation callback page; JSON `code: MAINTENANCE` for other `/api` calls; Retry-After, `no-store` and the security headers on both. Checks from the server use the internal listener (section 3), which the switch does not affect.
- The same page replaces nginx's own 502/504 on pages and on the callback, which covers every deploy gap.
- **Text:** bilingual (Q5), with the line "if you just paid, your payment is safe; we confirm it automatically".
- **`scripts/maintenance.sh on|off|status`:** it touches only the flag file and never runs up, down or restart.
- **RUNBOOK:** §4 written. §5 restore becomes: maintenance on, stop web, api and worker, keep nginx running, check through the internal listener.
- **CI docker job:**
  - flag on: through the published port, the page answers 503 with the HTML, `/api/ready` 503 MAINTENANCE and `/healthz` 200, and the IPN reaches the API; through the internal listener, `/api/ready` answers 200 with its body; the data services are untouched;
  - flag off: 200.

**Now, the checklist (in L12, with `bootstrap.sh`).**
- **RUNBOOK §9,** rewritten as T-7 → T-0 for this launch. New items:
  - Cloudflare settings and TLS; the page CSP; an outside port scan;
  - deploy, rollback and maintenance rehearsed on the VPS;
  - an off-server backup and a passed drill; the runtime role;
  - outside monitors and a fake alert received;
  - contacts filled in (RUNBOOK §8); the release SHA green on `main`;
  - the kill switches, in order: `registration_open=false`, then maintenance on, then `deploy.sh --rollback` (its smoke handles the flag, section 2), each checked through the internal listener; after maintenance off, the public smoke must pass.
- **The PayStation boot line** (payments' item, RUNBOOK §9) is checked by `prelaunch-check.sh` for **each** API replica since the last deploy; `deploy.sh` only checks that the line matches the `.env` (section 2). Every boot before the live switch raises `payments.disabled_in_production`, which is expected until then. For launch the line must show:
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
  - every app container runs the image of the recorded release; the boot lines; migrations up to date;
  - a clean production database: no fixture users, no test invoices, no published exam, fee 40000, `registration_open` as intended;
  - the newest backup under 26 h old, with its off-server copy;
  - the worker healthy with SES; the page CSP present;
  - real client IPs (VPS only): access-log lines from the last hour that came through a Cloudflare edge (the outside monitors make some) show a client address that differs from the edge and is not a Docker, private, loopback or Pseudo IPv4 (240.0.0.0/4) address;
  - time synced; disk and swap fine; the age of the Cloudflare IP list; the release SHA.

  `--local` marks the VPS-only checks N/A, so it also runs in the rehearsal and in CI.

**Waits for the VPS.**
- Maintenance on and off through Cloudflare: the 503 page is shown and not cached, and the IPN passes.
- `prelaunch-check.sh` all PASS on the VPS (it needs `env=live`, so the live merchant), and a fresh backup minutes before opening.
- Rasel's go/no-go on 14 Nov; then registration is opened through the audited admin setting.
- For the first week, the PayStation panel is compared with the database every day (`PAYMENTS-PLAN.md` §13.5).

## 8. Dashboard pages without data at launch: "coming soon"

**Today.**
- Production reads the API through the HTTP source (#23). `student.listExams` and `student.getExam` read `GET /exams` and `GET /exams/:id` (#23, #24), and `admin.listUsers` and `admin.getUser` read `GET /admin/users` (#26). Every other method falls back to `unavailable` and throws, so its page shows the error state: "Something went wrong… check your connection", with a retry that can never work (DECISIONS "Web data layer over HTTP" #2).
- `/dashboard` still calls `getHome()`, which no API serves. Core's C4 composes it in the web from `/users/me`, `/exams`, `/announcements` and payments' `/registrations/me` (CORE-PLAN D6, Mon 2 Nov). Until C4 merges, a student who pays and logs in lands on an error page.
- The error state cannot tell "not built" from "broken", and the alerts do not see it (section 6).
- `/dashboard/ambassador` shows invented numbers, in English only, until core's C5a merges the real panel.
- `GET /admin/stats` (the admin home numbers) has no owner (CORE-PLAN §0).

**Now, L1 (1.5–2 h).** It builds on #23, #24 and #26, which changed the same data files (and E4 `check-pages.mjs`). It lands after core's C3 and C4: L1 adds no guard to the home, and its live rule (below) fails while `/dashboard` still calls the unwired `getHome()`. If C4 is not on `main` by Wed 4 Nov, the lead can let L1 land first with a temporary `/dashboard` exemption in `check-pages` that C4 removes.
- **Launch table:** `apps/web/src/data/launch.ts` maps each `/dashboard` and `/admin` route to `live` or `soon`, with `isLive()` on top of #23's `createHttpSource`. It builds no new source. Each owner (exam, core, payments) flips its own entries when its area file lands; whoever merges second adds its new routes, and L1's route test enforces it.
- **`ComingSoon`** in `packages/ui`: `role="status"`, `data-state="coming-soon"`, neutral tokens, no retry button. bn/en strings per Q5; Rasel checks the Bangla.
- **Page guards** after `requireAccess()` and before any data call, on the pages marked `soon`. L1 does not change the dashboard home: its composition is core's (C4) and its cards are payments'.
- **"Soon" comes only from the table, never from an API answer:**
  - there is no try/catch around data calls, and a 404, 5xx or timeout never turns into "soon";
  - methods that are not wired still throw, so a page that forgets its guard fails CI;
  - with the API down, the error page still shows.

  L1's DECISIONS entry amends "Web data layer over HTTP" #2 for routes the table marks `soon`: they show `ComingSoon` instead of the error state.
- **Tests:**
  - every `/dashboard` and `/admin` route has a table entry, and no entry is orphaned;
  - production `isLive` equals the table;
  - `?mock=launch` previews the production view in development.
- **`check-pages`** reads the table:
  - prod: a "soon" page must show the marker with HTTP 200, and a "live" page must not show the error state. That rule then keeps the home from regressing;
  - `api-down` keeps one "soon" page and still expects the error page there.

| Page | Data on `main` today | 15 Nov | Owner |
|---|---|---|---|
| `/dashboard` | `getHome()`, no API: error state | composed in the web (C4), with payments' registration and book cards | core (C4), payments (PR 4, PR 6) |
| `/dashboard/exam`, `/dashboard/exam/[id]` | live: the list (#23) and the room (#24) | live, empty until an exam is published; "soon" only if Rasel asks (Q5) | exam |
| `/dashboard/leaderboard`, `/admin/exams`, `/admin/exams/[id]`, `/admin/leaderboard` | unavailable | live when E5 merges, else coming soon | exam (E5) |
| `/admin/users` | live (#26) | live | core |
| `/dashboard/profile`, `/dashboard/profile/edit`, `/dashboard/announcements`, `/dashboard/ambassador`, `/admin/announcements`, `/admin/ambassadors` | unavailable (the ambassador page: invented numbers) | live when core's PR merges (C3, C4, C5a are planned before 15 Nov), else coming soon | core |
| `/dashboard/book`; payments' admin pages (lookup, fee, book) | not built | live when merged | payments |
| `/admin` | `GET /admin/stats`: unavailable, no owner | coming soon (Q5) | — |

**Waits for the VPS.** One pass after the first deploy, as a real student (from the real payment) and as the first admin: every page shows real data or "coming soon", never the error page.

## 9. Session and token cleanup job

**Today.**
- There is no cleanup. `sessions` gains a row at every login and refresh and keeps minors' IPs and browsers; `auth_tokens` keeps expired tokens. Neither has an index on `expires_at` or `revoked_at`.
- Since #19 and #27 the worker has a database client (`ExamWorkerModule` imports `PrismaModule`) and two BullMQ job schedulers: the exam sweep every minute and payments' reconciliation.
- The recorded rule (DECISIONS A2.1b #9) deletes rows that expired or were revoked more than 30 days ago. A rotated row counts as revoked, so it goes 30 days after its rotation, even in a family that is still alive. A returning user is not affected: the refresh cookie expires with its token after 7 days, so a browser never sends an older one.
  - The only loss is one signal. A copied token replayed more than 30 days after its rotation is still refused, but it no longer ends the live family or writes `auth.refresh_reuse`.
  - A per-family rule would keep that signal, but also every retired row (IP, browser) of a live family for as long as the family lives, which has no limit because the 7-day expiry slides. That works against the privacy reason for the job. **Default: keep A2.1b #9 as recorded**; the lead can choose the per-family rule instead.

**Now, L13 (1.5 h).**
- **Schedule:** a nightly BullMQ job scheduler in its own worker module, next to the exam sweep: 03:30 Asia/Dhaka, one job per tick, 3 attempts, failed jobs kept 7 days.
- **Sessions:** rows that expired, or were revoked, more than 30 days ago.
- **Tokens:** deleted 7 days after expiry.
- **How it deletes:** batches of 1,000 under the 10 s statement timeout, a capped number of batches per run, and one log line and one audit row with counts only.
- **Never touched:** `audit_logs`, `payment_events`, `submissions`, payments, registrations, users, attempts.
- **An index migration:** `sessions(expires_at)`, `sessions(revoked_at)` and `auth_tokens(expires_at)`.
- **Tests:**
  - an expired row 31 days old is deleted, and one 29 days old is kept;
  - a retired row of a live family is deleted 30 days after its rotation; a replay of its token is refused, and the live session keeps working;
  - tokens 8 days past expiry are deleted, 6 days kept; the batch limits hold;
  - a second run deletes nothing, and two runs in parallel do not fail;
  - the append-only counts are unchanged, and two inits give one scheduler;
  - mutation checks on the cutoff, the expired-or-revoked condition and the batch limit.
- Payments' D6 payload scrub (abandoned attempts after 30 days) can join this job if the payments session agrees. Its first rows fall due around 15 Dec.

**Waits for the VPS.** Only the first night's log line. Nothing ages out before about 15 Dec, so if the schedule slips, this PR can follow the launch without harm.

## 10. Owner questions

Each question has a default; the work goes ahead on the default until Rasel answers.

1. **Backups: where, how often, how long, and who holds the key?**
   Default:
   - **Where:** an S3 bucket in the AWS account used for SES (ap-south-1), with versioning and lifecycle rules; a put-only key on the VPS, and a read-only key with Rasel for drills.
   - **How often and how long:** hourly encrypted dumps while registration is open, so at most 1 h is lost; 48 hourly + 7 daily + 4 weekly copies, about 35 days. The privacy page should state the period you choose (core's page, the client's text: please pass it on).
   - **Key holders:** two, Rasel and one person he names; never on the VPS, in git or in chat.
   - **Drills:** on Rasel's encrypted PC or a short-lived server, in a drill project reachable only from that machine, with payments off and email going to Mailpit, wiped afterwards. A short-lived server allows only SSH and is destroyed after the drill.

   Cost: well under 1 USD a month (estimate). If the AWS account is late: Cloudflare R2, with the same script.
2. **Alerts: which outside service, who gets them, separate caps, and what waits until later?**
   Default:
   - **Service:** the free tier of an outside uptime and heartbeat service (for example Better Stack, or UptimeRobot with Healthchecks.io; terms checked first), checking every 3–5 min. RULEBOOK §12 asks for every minute, so the launch interval departs from it; a flat paid plan with 1-minute checks comes before the first exam day.
   - **Who:** Rasel and one backup person, by email and Telegram or the service's phone app. `SECURITY_ALERT_EMAIL` is a group address for both.
   - **Caps:** security, payments and ops alerts get their own cap of 6 emails an hour each (today one shared cap of 6).
   - **Error tracking and server metrics** (RULEBOOK §12 asks for Sentry or a self-hosted equivalent, and Netdata or Prometheus + Grafana): none at launch. Structured logs, the 5xx, p95, CPU and memory alerts and the host checks stand in until then. Before the exam phase, add both, sized on the VPS: Netdata bound to localhost (read over SSH) for server metrics, and a self-hosted error tracker for the API and the web. Keeping only one would be a further §12 departure.
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
   - **The deploy gap** (RULEBOOK §14 asks for new containers first, then a traffic switch): at launch `deploy.sh` restarts the replicas in place, 10–20 s, off-peak behind the maintenance page. Zero-downtime switching comes after launch.
   - **Freeze:** 48 h, from Fri 13 Nov 00:00 (RULEBOOK §13). It ends payments' non-critical deploys on Thu 12 instead of Sat 14 (`PAYMENTS-PLAN.md` §10.3). Configuration-only switches (the PayStation live account, the SES keys) and critical fixes still go ahead. After launch, deploys run between 00:00 and 07:00 Asia/Dhaka.
   - **Rehearsal machine:** a throwaway Ubuntu 24.04 VM for the L9 rehearsal and the `bootstrap.sh` test: a Hyper-V VM on Rasel's PC that he sets up (30–60 min), or a short-lived cloud VM destroyed after use. Without one, the rehearsal runs in its own clone, and `bootstrap.sh` has its first full run on the VPS on Sat 7 (about 1 h more that day).
   - **Admin accounts without 2FA at launch** (RULEBOOK §5: "recommended before launch"): at most two, created with the CLI, with long unique passwords in a password manager. 2FA is the first PR after launch.
5. **What students and admins see at launch.**
   Default:
   - **"Coming soon":** neutral text without dates. bn "শীঘ্রই আসছে। এই অংশটি পরে চালু হবে। এখন আপনাকে কিছু করতে হবে না।", en "Coming soon. This section opens later. You do not need to do anything now."
   - **Menus:** items stay visible and lead to that page.
   - **The exam list:** live, empty until an exam is published. Say if it should be "coming soon" until the schedule is announced.
   - **Maintenance page:** a generic bn/en "we'll be right back" with the "your payment is safe" line, and no contact details until the client gives one.
   - **Admin home numbers** (registered, paid, pending): "coming soon". Core's students list and payments' lookup cover the need; `GET /admin/stats` has no owner, and live numbers would be one small API PR, about 2 h.

## 11. Defaults for the lead

These are technical choices inside the RULEBOOK. Each is recorded in DECISIONS with the PR that needs it. Choices that depart from the RULEBOOK are owner questions (Q2, Q4).
- Cloudflare Origin CA with Full (strict). No Cloudflare Tunnel. Authenticated Origin Pulls after launch. A Let's Encrypt fallback is only documented.
- The real client IP comes only from `CF-Connecting-IP` with Cloudflare's ranges, never from Docker ranges in production.
- Maintenance lets the PayStation IPN through. Checks from the server use an internal listener, not a client-address exception.
- No per-IP `limit_conn`: RULEBOOK §11 lists `limit_req` / `limit_conn`, `limit_req` covers it, and a connection cap would refuse a school.
- The login limiter's 100 failures per minute per IP stays for launch (owner rule), since logins after payment are spread out. Revisit before the first exam with k6 data.
- A page CSP with `'unsafe-inline'` scripts at launch; nonces or hashes after launch.
- Dumps, not WAL archiving, for launch. WAL after launch, never in the last week before it.
- After a restore everyone logs in again.
- Runtime role `sirat_app`; the bootstrap superuser stays owner and migrator. A non-superuser owner can come later.
- The cleanup follows DECISIONS A2.1b #9 as recorded (section 9). No job ever purges the audit or payment-event logs.
- No Cloudflare Turnstile at launch.

## 12. Schedule at the measured pace

**Measured on 31 Oct (GitHub timestamps):**
- Medium PRs took 1.3–2.0 h from the first commit to the merge: A2 #15 2.0 h and #20 1.3 h; exam #16 1.9 h and #17 1.6 h.
- Bigger ones took 3.9 h (#14) and 5.5 h (#12, which waited on #10).
- PRs merged 5–60 min after they opened, once CI was green and the lead had reviewed them.
- Three sessions made 48 commits (merges not counted) on 30 Oct and 110 on 31 Oct. Payments is about 2 days ahead of its own plan: #21 (steps 4–5) merged Sat 31 Oct instead of Mon 2 Nov, and #27 (steps 6–9) on Sun 1 Nov instead of Tue 3 – Wed 4.

The table assumes about 2 h per medium PR, review rounds included. These are estimates, not commitments.

| Day | A2 (estimate) | Outside (owner, client, others) |
|---|---|---|
| Sun 1 Nov | L2 role and grants (with one stack turn), L3 TLS-ready nginx, logs and CSP | Rasel answers Q1–Q5 (defaults apply meanwhile) and types the dev `sirat_app` password; core C1; exam E4/E5 PRs |
| Mon 2 Nov | L4 real IPs and shared IPs, L5 maintenance, L6 backups | Domain: Cloudflare zone, SES domain identity, production access requested; core C3 and C4 (the home) |
| Tue 3 Nov | L1 coming soon (after core's C3 and C4), L7 restore and drill, L8 role switch (stack window) | Bucket and keys; outside monitor account; the rehearsal VM (Q4) |
| Wed 4 Nov | L9 `deploy.sh` and the release file, L10 alert categories | Domain at the latest |
| Thu 5 Nov | L11 `ops-check` and `monitor.sh`, L12 bootstrap (start) | Payments PR 4 (web); payments' registration e2e with the CSP listener |
| Fri 6 Nov | L12 bootstrap, prelaunch-check, RUNBOOK §9; L13 cleanup; L14 part 1 if the specs differ | Sandbox session with Rasel (payments); the VPS specs confirmed (OPEN-QUESTIONS #22) |
| Sat 7 Nov | VPS with Rasel, in the order of section 2: bootstrap, certificate, first start, Cloudflare and firewall, first deploy, first admins, scan (5–7 h in all) | VPS target; core's pages go live, and PayStation's review can start |
| Sun 8 – Mon 9 Nov | On the VPS: rehearsals (about 2 h); backup timers, first copy, failure alert (about 1 h); monitors and the fake-alert drill (1.5–2 h); real-IP check on the three operators (about 1 h) | |
| Tue 10 – Wed 11 Nov | Restore drill 1 on another machine (1–1.5 h); k6 with simulated shared IPs, in payments' k6 window, then the trusted generator removed in the same slot; L14 part 2 | VPS at the latest (Tue 10); live merchant; real payment; k6 registration surge (payments) |
| Thu 12 Nov | Final release candidate deployed, with L14; `prelaunch-check.sh` all PASS | Live merchant at the latest |
| Fri 13 Nov | Freeze from 00:00; restore drill 2 (T-2) | SES at the latest |
| Sat 14 Nov | Go/no-go (Rasel) | |
| Sun 15 Nov | Registration opens through the audited admin setting | |

- **L14 "VPS tuning" (1–2 h, two small parts):**
  - **Part 1, only if the VPS is not 8 vCPU / 32 GB:** retune `postgresql.conf` and the compose limits before the data services first start. `deploy.sh` never restarts them, so a later change needs its own Postgres restart.
  - **Part 2, after k6:** the nginx zones, the API's refresh tier and the monitor thresholds, shipped in the Thu 12 release candidate. If k6 shows nothing to change, only the numbers go into DECISIONS.
- **One session:** the code is ready by Fri 6 Nov, before the VPS. If the lead gives L6–L7 and L10–L11 to a second session (their files barely overlap), by about Wed 4 Nov.
- **Domain on Wed 4 Nov:** no code waits; only SES and the Cloudflare zone move.
- **VPS on Tue 10 Nov:** the VPS work of 7–9 Nov moves into 10–12 Nov, next to the live switch and k6, with no slack left. PayStation's review then starts Tue 10 at the earliest, so the live merchant misses its Tue 10 target, and Thu 12 (with `prelaunch-check.sh`, which needs `env=live`) depends on how fast PayStation reviews. If the live account is late, the release is ready but registration stays closed, and the owner decides the date (section 14).

**Does not compress (kept apart from the estimates):**
- the domain, then Cloudflare activation (minutes to 48 h; days for a .bd domain);
- SES DKIM verification (hours) and production access (an AWS review that can take days);
- the VPS delivery (7 Nov, latest 10 Nov);
- PayStation's live review, which starts only once the site is live on the domain (VPS, first deploy, TLS, core's pages with the client's texts); its length is PayStation's;
- sessions with Rasel present: bootstrap and first deploy 3–4 h; TLS and firewall 2–3 h; drills 1.5–2 h; each restore drill 1–1.5 h with a key holder;
- owner accounts and machines: bucket and keys 30–60 min; the monitor service about 30 min; age keys offline 15–30 min; the rehearsal VM 30–60 min (Q4);
- phone checks on the three mobile operators and IPv6 (about 1 h, with people on those networks);
- a `main` CI run before each deploy (20–30 min);
- the lead's review of each PR, and the shared-stack turns (one session at a time);
- the 48 h freeze;
- the HSTS ramp after launch (days to weeks; not on the launch path).

## 13. Shared files, stack turns and merge order

- **Files other sessions also change:**
  - `apps/web/src/data/*`: #23 landed first. The area files belong to exam (`http/exams.ts`, extended by E4 in #24), core (`users` since #26; `announcements`, `ambassador`) and payments. L1 adds only `launch.ts`, `isLive()` and the guards, and merges after core's C3 and C4 (section 8); for everything else, whoever merges second adds its routes to the table.
  - `(student)/dashboard/page.tsx`: core C4 (the composition) and payments (its cards). L1 does not change it. `PAYMENTS-PLAN.md` §16 still calls it "a file A2 owns": the lead tells payments that it is core's now.
  - `apps/web/scripts/check-pages.mjs`: E4 (#24) and core C2 (#25) changed it; L1 adds the per-page expectations.
  - `packages/ui/src/index.ts`: one export line each (core's `Prose` is in; L1 adds `ComingSoon`).
  - `security-alerts.service.ts`: payments PR 3 (#27) added `payments.needs_review`; L10 gives every kind a category, and a later kind without one fails typecheck, whoever adds it.
  - `worker.ts`: the exam and payments worker modules are in (#19, #27); L13 adds its own, and core C5b and C6c follow after launch: one import line each, keep all.
  - Migrations (L2, L13): run `git merge origin/main`, keep both sides, and regenerate a generated migration per `PAYMENTS-PLAN.md` §12.
  - Also `infra/docker-compose.yml`, `ci.yml`, both `.env.example` files, RUNBOOK, 05-DATABASE and 06-API.
  - Only this plan changes `nginx.conf`: L3, then L4, then L5 (and L14 part 2). DECISIONS merges as a union; after each merge, check the blank line before every entry.
- **The page CSP and payments' e2e:** payments' registration e2e (PR 4/5) runs with L3's CSP listener and must pass before the policy is enforced on the VPS (section 3). The lead tells payments.
- **Freeze and payments' buffer:** with the freeze from Fri 13 00:00 (Q4), Thu 12 is the last day for non-critical deploys, such as a slipped free-book PR. So the non-critical part of `PAYMENTS-PLAN.md` §10.3's buffer (Sun 8 midday – Sat 14) ends on Thu 12. Critical fixes and configuration-only switches still go ahead. The lead tells payments when this plan merges.
- **Shared stack:** each of these PRs needs a turn, asked for first, announced in one line and released after:
  - L1: web smoke and e2e;
  - L2: one run of `runtime-role.ts` that sets the dev `sirat_app` password;
  - L3–L5: nginx;
  - L7: one read-only dump of the dev database;
  - L8: it recreates PgBouncer, so it needs one window with Rasel.

  L9's rehearsal and the L6–L7 tests run in their own compose projects with their own ports (or in the throwaway VM); outside the VM they are announced, because they share CPU, RAM and the image store.
- **Every PR follows the usual rules:** contract or decision first; tests and mutation checks; the full pre-PR checks; a description ending "Ready to merge: <sha>".

## 14. Risks

1. **A late VPS.** Tue 10 Nov is the latest VPS date that still keeps 15 Nov (`PAYMENTS-PLAN.md` §10.2), and even then the VPS work fills 10–12 Nov with no slack (section 12). If the VPS comes later, the sessions with Rasel do not fit before the freeze unless a check is cut. Nothing is cut, so the owner decides the date (`PAYMENTS-PLAN.md` §14, risk 1). A VPS on Tue 10 also starts PayStation's live review on Tue 10 at the earliest. The live merchant (latest Thu 12), and with it `prelaunch-check.sh` all PASS, then depends on how fast PayStation reviews. If the live account is late, the release is ready but registration stays closed (`PAYMENTS-PLAN.md` §14, risk 4), and the owner decides the date. Mitigation: everything is rehearsed locally first (the L9 rehearsal, the L7 drill, `prelaunch-check --local`), and the VPS day follows a written script, so the VPS work itself still fits on Tue 10.
2. **The dashboard home and L1 depend on core's C3 and C4.** If C4 is not on `main` by the release candidate (Thu 12), paying students land on an error page. L1 waits for it too, so until then every page without data keeps the error state. Mitigation: the lead tracks C3 and C4; if the home is late by Wed 4 Nov, L1 lands first with a temporary `/dashboard` exemption that C4 removes (section 8). Once both are in, L1's rule keeps the home from regressing.
3. **Shared IPs:** one school or operator IP can still hit nginx or API limits during the registration surge. Mitigation: L4, payments' tiers, and the final numbers from k6 with simulated shared IPs (L14); the access log shows who got a 429.
4. **A silently broken real-IP restore** (an AAAA record or IPv6 listener, a stale Cloudflare list, a Cloudflare setting): everyone shares one bucket. Mitigation: IPv4-only bindings and an A record only; the Cloudflare checklist; the real-IP check on the VPS (section 3); and in `prelaunch-check.sh`, the age of the Cloudflare IP list plus the client addresses in recent access-log lines, run again after k6 removes its trusted generator and on the Thu 12 release candidate.
5. **The worker confirms every payment.** Without SES keys it will not start, and a stopped worker cannot email its own alert. Mitigation: the IAM keys go into `.env` before opening, even if production access is pending; the monitor heartbeat fails on any critical state, so the outside service reports a stopped worker (section 6).
6. **Restores:** a lost decryption key makes every copy useless, and a restore older than the newest payments needs a manual match against a PayStation export. Mitigation: two key holders, tested at every drill; hourly dumps; the after-restore steps in `restore.sh`; the role made before `pg_restore`.
7. **Helmet's HSTS** (1 year, `includeSubDomains`) would go out with the first HTTPS response and cannot be recalled. Mitigation: L3 turns it off before TLS exists.
8. **Docker bypasses UFW:** the server can look firewalled when it is not. Mitigation: the provider firewall or DOCKER-USER rules, and an outside port scan on the checklist.
