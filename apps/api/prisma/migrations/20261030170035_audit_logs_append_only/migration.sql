-- audit_logs is append-only (A2.1): rows are inserted and read, never changed or removed, so an application bug or
-- an injected statement cannot rewrite the security trail. UPDATE, DELETE and TRUNCATE all fail.
-- The table owner can still disable the triggers on purpose (a deliberate DBA action, never done by the app).
-- Tests do not truncate this table (test/helpers.ts truncateAll); they tell their rows apart by ids.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
