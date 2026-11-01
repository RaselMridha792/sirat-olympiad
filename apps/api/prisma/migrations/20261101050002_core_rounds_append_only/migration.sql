-- promotion_runs is a historical record (core C6a; lead's review of #71): rows are added by a promotion and never
-- changed or removed, like payment_events and point_ledger. UPDATE and DELETE are refused; TRUNCATE too, except in a
-- database whose name ends exactly in `_test`: unlike payment_events, this table references users and rounds, so the
-- integration tests' truncateAll (TRUNCATE ... CASCADE) reaches it. Production's database is `sirat`, and the runtime
-- role has no TRUNCATE right anyway. Hand-written: Prisma does not diff triggers.
CREATE FUNCTION "promotion_runs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND right(current_database(), 5) = '_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'promotion_runs is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER "promotion_runs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "promotion_runs"
  FOR EACH ROW EXECUTE FUNCTION "promotion_runs_append_only"();

CREATE TRIGGER "promotion_runs_no_truncate"
  BEFORE TRUNCATE ON "promotion_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION "promotion_runs_append_only"();

-- A new table gets sirat_app's data rights from the default privileges (20261031224147_runtime_role), but not that
-- migration's REVOKE for append-only tables: this one revokes its own. Guarded like the runtime_role migration, for a
-- database where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "promotion_runs" FROM sirat_app;
  END IF;
END
$$;
