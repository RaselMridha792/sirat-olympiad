-- Runtime role for the API, the worker, the seed and the CLI (OPEN-QUESTIONS #27, LAUNCH-PLAN L2). Nothing connects as
-- it yet: L8 points DATABASE_URL at it. The bootstrap superuser stays the owner of every object and runs migrations, so
-- the default privileges below apply to every table a later migration creates.
-- Its login and password are set by prisma/runtime-role.ts (the migrate job), never here: no password in SQL.

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

-- Grants are per database: every database that runs this migration gets them.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sirat_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO sirat_app;

-- Data only: no TRUNCATE, REFERENCES or TRIGGER, and no CREATE on the schema (PostgreSQL 15+ gives that to the owner
-- only), so an injected statement cannot drop, truncate, disable a trigger or add a table.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sirat_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sirat_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM sirat_app;

-- The append-only tables (each has an *_append_only trigger): rows are added, never changed or removed.
REVOKE UPDATE, DELETE ON TABLE "audit_logs", "payment_events", "submissions" FROM sirat_app;

-- Every table or sequence a later migration creates gets the same data rights. A new append-only table needs its own
-- REVOKE in its migration; the catalog test (test/db-runtime-role.int-spec.ts) finds them by their trigger.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sirat_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sirat_app;
