-- Jury (core C6b): the limits the API checks, kept by the database too, and jury_scores append-only (lead's notes on
-- the C6 plan). Hand-written: Prisma ignores CHECKs and triggers when diffing.

-- A score row: criteria as a JSON object of key -> 0..10, the total out of 100 (the server scales the sum), a short
-- comment for the judges' record (never shown to the student).
ALTER TABLE "jury_scores"
  ADD CONSTRAINT "jury_scores_total_check" CHECK ("total" BETWEEN 0 AND 100),
  ADD CONSTRAINT "jury_scores_criteria_check" CHECK (jsonb_typeof("criteria") = 'object'),
  ADD CONSTRAINT "jury_scores_comment_check" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);

-- The scoring history is never changed or removed: a judge scores again with a new row. UPDATE and DELETE are
-- refused; TRUNCATE too, except in a database whose name ends exactly in `_test` (the integration tests'
-- truncateAll cascades into it through users and round_entries). Production's database is `sirat`, and the runtime
-- role has no TRUNCATE right anyway.
CREATE FUNCTION "jury_scores_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND right(current_database(), 5) = '_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'jury_scores is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER "jury_scores_no_update_delete"
  BEFORE UPDATE OR DELETE ON "jury_scores"
  FOR EACH ROW EXECUTE FUNCTION "jury_scores_append_only"();

CREATE TRIGGER "jury_scores_no_truncate"
  BEFORE TRUNCATE ON "jury_scores"
  FOR EACH STATEMENT EXECUTE FUNCTION "jury_scores_append_only"();

-- jury_scores came with A1, before the runtime role, so it has sirat_app's full data rights from that migration's
-- grants; its REVOKE loop ran only for the append-only tables of its time. This one revokes its own. Guarded like
-- the runtime_role migration, for a database where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "jury_scores" FROM sirat_app;
  END IF;
END
$$;
