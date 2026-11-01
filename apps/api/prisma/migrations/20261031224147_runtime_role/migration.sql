-- Runtime role for the API, the worker, the seed and the CLI (OPEN-QUESTIONS #27, LAUNCH-PLAN L2). Nothing connects as
-- it yet: L8 points DATABASE_URL at it. The bootstrap superuser stays the owner of every object and runs migrations, so
-- the default privileges below apply to every table a later migration creates.
-- Its login and password are set by prisma/runtime-role.ts (the migrate job), never here: no password in SQL. That
-- script also re-asserts the restrictions below after every `migrate deploy` (a restore can lose them).

-- Roles belong to the whole cluster: created once, by whichever database migrates first. Two databases migrating at
-- the same moment (dev worktrees share one cluster) can both pass the NOT EXISTS check; the loser is harmless.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    CREATE ROLE sirat_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

-- Grants are per database: every database that runs this migration gets them. No temporary tables for anyone but the
-- owner: for a table name without a schema PostgreSQL looks in the session's temporary schema first, so a temporary
-- table could stand in for a real one inside the trigger functions and get past their checks.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sirat_app', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO sirat_app;

-- Data only: no TRUNCATE, REFERENCES or TRIGGER, and no CREATE on the schema (PostgreSQL 15+ gives that to the owner
-- only), so an injected statement cannot drop, truncate, disable a trigger or add a table.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sirat_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sirat_app;

-- Nothing on the migration log. Prisma's shadow database (migrate dev, CI's drift check) replays these files into an
-- empty database that has no such table, hence the guard.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM sirat_app;
  END IF;
END
$$;

-- The append-only tables, found by their *_append_only trigger function (audit_logs, payment_events, point_ledger and
-- submissions today): rows are added, never changed or removed.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND p.proname LIKE '%\_append\_only'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM sirat_app', t.relname);
  END LOOP;
END
$$;

-- Every table or sequence a later migration creates gets the same data rights. A later append-only table needs its own
-- REVOKE in its migration; the catalog test (test/db-runtime-role.int-spec.ts) finds them by their trigger.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sirat_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sirat_app;
