-- Registration fee: 400 BDT = 40000 paisa (DECISIONS 2026-10-31 "Registration fee", owner). Data migration, M2 in
-- docs/plans/PAYMENTS-PLAN.md section 3.3.
-- The migrate job runs migrations first and the seed second, and the seed only inserts missing keys. An UPDATE alone
-- would do nothing on an empty database (the seed would then write its default), so this upserts:
--   key missing           -> 40000 (+ audit row)
--   key still placeholder -> 40000 (+ audit row)
--   any other value       -> untouched (an admin chose it), no audit row
-- Runs before the settings CHECK of the next migration, so an existing placeholder 0 never makes that CHECK fail.
-- audit_logs ids come from gen_random_uuid() (v4): Postgres 17 has no built-in v7 generator; only Prisma makes v7.
WITH changed AS (
  INSERT INTO "settings" ("key", "value", "created_at", "updated_at")
  VALUES ('registration_fee_minor', '40000'::jsonb, now(), now())
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()
  WHERE "settings"."value" = '0'::jsonb
  RETURNING "key"
)
INSERT INTO "audit_logs" ("id", "action", "entity_type", "entity_id", "meta", "created_at")
SELECT gen_random_uuid(), 'settings.registration_fee_set', 'setting', "key",
       '{"to": 40000, "by": "migration"}'::jsonb, now()
FROM changed;
