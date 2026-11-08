-- answer_key_corrections' CHECKs and triggers (E7b). Hand-written and kept apart from the generated migration, so
-- regenerating that one never loses them. Names are explicit so test/exam-key-corrections.int-spec.ts can assert them.

ALTER TABLE "answer_key_corrections"
  ADD CONSTRAINT "answer_key_corrections_keys_check" CHECK ("from_key" ~ '^[A-Z]$' AND "to_key" ~ '^[A-Z]$'),
  ADD CONSTRAINT "answer_key_corrections_changes_check" CHECK ("to_key" <> "from_key"),
  ADD CONSTRAINT "answer_key_corrections_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 200);

-- A correction is about a question of that exam, once the exam is published (a draft is simply edited), and both keys
-- are options of that question version. The service checks the same under the exam's lock; this is the last line.
CREATE FUNCTION "answer_key_corrections_valid"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  q RECORD;
BEGIN
  SELECT qu."exam_id", qu."options", e."status"::text AS "status" INTO q
  FROM "questions" qu JOIN "exams" e ON e."id" = qu."exam_id"
  WHERE qu."id" = NEW."question_id";
  IF NOT FOUND OR q."exam_id" <> NEW."exam_id" THEN
    RAISE EXCEPTION 'answer_key_corrections: question % is not in exam %', NEW."question_id", NEW."exam_id";
  END IF;
  IF q."status" = 'draft' THEN
    RAISE EXCEPTION 'answer_key_corrections: exam % is a draft: edit the question instead', NEW."exam_id";
  END IF;
  IF NOT (q."options" @> jsonb_build_array(jsonb_build_object('key', NEW."to_key"))
          AND q."options" @> jsonb_build_array(jsonb_build_object('key', NEW."from_key"))) THEN
    RAISE EXCEPTION 'answer_key_corrections: % or % is not an option of question %',
      NEW."from_key", NEW."to_key", NEW."question_id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "answer_key_corrections_valid"
  BEFORE INSERT ON "answer_key_corrections"
  FOR EACH ROW EXECUTE FUNCTION "answer_key_corrections_valid"();

-- The corrections are the record of what was changed and why: rows are added, never changed or removed (a revert is
-- another correction). TRUNCATE is refused too, except in a database whose name ends exactly in `_test`: the table
-- references exams, questions and users, so the integration tests' truncateAll (TRUNCATE ... CASCADE) reaches it.
-- Production's database is `sirat`, and the runtime role has no TRUNCATE right anyway (as promotion_runs).
CREATE FUNCTION "answer_key_corrections_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND right(current_database(), 5) = '_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'answer_key_corrections is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER "answer_key_corrections_no_update_delete"
  BEFORE UPDATE OR DELETE ON "answer_key_corrections"
  FOR EACH ROW EXECUTE FUNCTION "answer_key_corrections_append_only"();

CREATE TRIGGER "answer_key_corrections_no_truncate"
  BEFORE TRUNCATE ON "answer_key_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION "answer_key_corrections_append_only"();

-- A new table gets sirat_app's data rights from the default privileges (20261031224147_runtime_role), but not that
-- migration's REVOKE for append-only tables: this one revokes its own. Guarded like the runtime_role migration, for a
-- database where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "answer_key_corrections" FROM sirat_app;
  END IF;
END
$$;
