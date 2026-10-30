# OPEN QUESTIONS (ask the owner before building the affected part)

Owner = Rasel Mridha. Client = GLTS Leadership × Sirat Olympiad. Add the answer + date, then move it to DECISIONS.md.

## Blocking for specific modules

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | **PayStation:** merchant account + sandbox credentials? Which methods enabled? Who pays the gateway charge (`pay_with_charge`)? Callback parameter names, checkout expiry, IPN retry rules (not in public docs)? Currency BDT only? | Payments | Build against sandbox; expiry 60 min; `pay_with_charge=1`; verify callback params in sandbox |
| 2 | Registration fee amount and registration open/close dates | Registration | Config in `settings`, no hardcoding |
| 3 | Category ↔ grade-level mapping for the 17 grade levels (Activist / Ambassador / Achiever bands) | Seed data | Use old bands (SDG 1–4 → Activist, 5–10 → Ambassador, 11–17 → Achiever) |
| 4 | Exam format: question types, count, negative marking, image questions, languages | Exam engine | MCQ A–D, no negative marking, text only |
| 5 | Question **pool size** and questions per attempt | Exam engine | Pool configurable per exam |
| 6 | Exam window length per exam; is 30 min a hard max for every exam? | Exam config | CHECK ≤ 30 |
| 7 | Submit **grace period** after `ends_at` | Submit | 30 s |
| 8 | Disconnect mid-exam: timer keeps running — confirmed with client? | Exam rules | Yes (RULEBOOK 7.1) |
| 9 | Tab-switch / focus-loss logging: off, log-only, or auto-submit after N violations? | Exam player | Log-only, optional flag |
| 10 | Show **scores** on the leaderboard or only rank/name? | Leaderboard | Rank + name + institution only |
| 11 | **`manager` role:** what are its duties? | Roles/admin | Read-only staff until defined |
| 12 | **Ambassador:** admin approval required, or self-generated code? | Ambassador | Admin approval |
| 13 | Ranks (names + point thresholds) and points per event (referral paid, task) | Ambassador | Bronze/Silver/Gold, thresholds editable |
| 14 | Round structure after Round 1 (video? final? how many?) and jury count/criteria (old: 10 criteria 0–10) | Rounds | Data-driven; port old criteria |
| 15 | Certificates: types, wording, who gets which, signatures | Certificates | Participation + promotion + winner, server-issued |
| 16 | Email provider and sending domain (SPF/DKIM/DMARC) | Notifications | Queue + provider abstraction |
| 17 | Domain, Cloudflare available? TLS plan | Nginx | HTTP in compose, TLS TODO |
| 18 | Off-server backup target (S3-compatible or second machine) | Backups | Local dump + TODO |
| 19 | Import old Season 2 users/results, or start fresh? | Migration | Start fresh |
| 20 | Teachers/schools: dashboards, bulk registration? | Scope | Out of scope |
| 21 | Languages: Bangla + English both at launch? Mobile app later? | i18n | Both, web only |
| 22 | Hosting: confirm Hostinger KVM 8 specs; Malaysia/AWS fallback plan | Infra | Single VPS |
| 23 | Support coverage promised to client (exam-day only vs 24/7 any-time) | Runbook/contract | Exam-day only |
| 24 | Real expected **peak concurrency** and whether starts are bunched (e.g. at window open) | Load test | 1,300–3,800 estimate |

## Notes from the old system worth confirming

* Old `/api/leaderboard` showed rank/name/institution/status but no scores.
* Old certificate eligibility was `is_participated` / round ≥ 2, decided in the browser; new rule: server decides from DB state.
