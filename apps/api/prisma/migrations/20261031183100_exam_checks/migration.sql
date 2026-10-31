-- Exam engine CHECKs, partial indexes and triggers (docs/plans/EXAM-PLAN.md 2.2, 2.4). Hand-written and kept apart
-- from the generated *_exam_engine migration, so regenerating that one never loses them. Prisma ignores CHECKs,
-- triggers and partial indexes when diffing, so later migrations will not drop them (as in payments' *_payments_checks).
-- Names are explicit so test/exam-constraints.int-spec.ts can assert them.
--
-- Enums: CHECK constraints compare `::text` (an enum literal in a CHECK breaks Prisma's enum migrations; DECISIONS A1
-- review #2). A partial index predicate cannot (Postgres requires IMMUTABLE functions there and the enum-to-text cast
-- is only STABLE), so attempts_in_progress_ends_at_idx compares an enum literal. A future migration that RECREATES
-- "AttemptStatus" (removing or renaming a value; adding one is fine) must drop and recreate that index around it.

-- ───────────── exams ─────────────

ALTER TABLE "exams"
  ADD CONSTRAINT "exams_grace_seconds_max_check" CHECK ("grace_seconds" <= 300),
  ADD CONSTRAINT "exams_content_version_check" CHECK ("content_version" >= 1),
  ADD CONSTRAINT "exams_results_generation_check" CHECK ("results_generation" >= 0),
  ADD CONSTRAINT "exams_published_at_check" CHECK ("status"::text <> 'published' OR "published_at" IS NOT NULL),
  -- Results (scores, correct answers) can only be published once the window has closed for everyone.
  ADD CONSTRAINT "exams_results_after_window_check" CHECK (
    "results_published_at" IS NULL
    OR ("status"::text <> 'draft' AND "results_published_at" >= "window_end" + "grace_seconds" * interval '1 second')
  );

-- Once published, an exam's timing and pool rules are frozen: attempts already started depend on them.
CREATE FUNCTION "exams_frozen_after_publish"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status"::text = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD."status"::text = 'archived' THEN
    RAISE EXCEPTION 'exams_frozen_after_publish: exam % is archived', OLD."id";
  END IF;
  IF NEW."window_start" IS DISTINCT FROM OLD."window_start"
     OR NEW."duration_minutes" IS DISTINCT FROM OLD."duration_minutes"
     OR NEW."questions_per_attempt" IS DISTINCT FROM OLD."questions_per_attempt"
     OR NEW."grace_seconds" IS DISTINCT FROM OLD."grace_seconds"
     OR NEW."category" IS DISTINCT FROM OLD."category"
     OR NEW."round_id" IS DISTINCT FROM OLD."round_id"
     OR NEW."random_draw" IS DISTINCT FROM OLD."random_draw" THEN
    RAISE EXCEPTION 'exams_frozen_after_publish: exam % is published; its timing and pool cannot change', OLD."id";
  END IF;
  IF NEW."window_end" IS DISTINCT FROM OLD."window_end"
     AND (NEW."window_end" < OLD."window_end" OR OLD."window_end" <= now()) THEN
    RAISE EXCEPTION 'exams_frozen_after_publish: the window of exam % can only be extended while it is open', OLD."id";
  END IF;
  IF NEW."status"::text = 'draft' AND EXISTS (SELECT 1 FROM "attempts" WHERE "exam_id" = OLD."id") THEN
    RAISE EXCEPTION 'exams_frozen_after_publish: exam % has attempts and cannot go back to draft', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "exams_frozen_after_publish"
  BEFORE UPDATE ON "exams"
  FOR EACH ROW EXECUTE FUNCTION "exams_frozen_after_publish"();

-- ───────────── questions ─────────────

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "questions_position_check" CHECK ("position" >= 1),
  ADD CONSTRAINT "questions_active_check" CHECK ("is_active" = ("deactivated_at" IS NULL)),
  ADD CONSTRAINT "questions_text_check" CHECK (char_length("text") BETWEEN 1 AND 2000),
  ADD CONSTRAINT "questions_explanation_check" CHECK ("explanation" IS NULL OR char_length("explanation") <= 4000),
  ADD CONSTRAINT "questions_options_check" CHECK (
    CASE WHEN jsonb_typeof("options") = 'array' THEN jsonb_array_length("options") BETWEEN 2 AND 6 ELSE false END
  ),
  ADD CONSTRAINT "questions_correct_key_check" CHECK (
    "options" @> jsonb_build_array(jsonb_build_object('key', "correct_key"))
  );

-- One active version per question.
CREATE UNIQUE INDEX "questions_one_active_version_key" ON "questions" ("lineage_id") WHERE "is_active";

-- A question someone may already have answered is never rewritten or removed: once its exam has left draft, the only
-- change allowed is deactivation (a new version replaces it, or the admin retires it).
CREATE FUNCTION "questions_frozen_after_publish"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  exam_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status"::text INTO exam_status FROM "exams" WHERE "id" = NEW."exam_id";
    IF exam_status = 'archived' THEN
      RAISE EXCEPTION 'questions_frozen_after_publish: exam % is archived', NEW."exam_id";
    END IF;
    RETURN NEW;
  END IF;

  SELECT "status"::text INTO exam_status FROM "exams" WHERE "id" = OLD."exam_id";
  IF exam_status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR exam_status = 'archived' THEN
    RAISE EXCEPTION 'questions_frozen_after_publish: % of question % in a % exam', TG_OP, OLD."id", exam_status;
  END IF;
  IF NEW."exam_id" IS DISTINCT FROM OLD."exam_id"
     OR NEW."lineage_id" IS DISTINCT FROM OLD."lineage_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."text" IS DISTINCT FROM OLD."text"
     OR NEW."options" IS DISTINCT FROM OLD."options"
     OR NEW."correct_key" IS DISTINCT FROM OLD."correct_key"
     OR NEW."explanation" IS DISTINCT FROM OLD."explanation"
     OR NEW."position" IS DISTINCT FROM OLD."position"
     OR NEW."keep_option_order" IS DISTINCT FROM OLD."keep_option_order"
     OR (NEW."is_active" AND NOT OLD."is_active") THEN
    RAISE EXCEPTION 'questions_frozen_after_publish: question % is published; save a new version instead', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "questions_frozen_after_publish"
  BEFORE INSERT OR UPDATE OR DELETE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "questions_frozen_after_publish"();

-- Every question write raises the exam's content version (caches and new attempts use the current pool).
CREATE FUNCTION "questions_bump_exam_content_version"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "exams"
     SET "content_version" = "content_version" + 1, "updated_at" = now()
   WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."exam_id" ELSE NEW."exam_id" END;
  RETURN NULL;
END
$$;

CREATE TRIGGER "questions_bump_exam_content_version"
  AFTER INSERT OR UPDATE OR DELETE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "questions_bump_exam_content_version"();

-- ───────────── attempts ─────────────

ALTER TABLE "attempts"
  ADD CONSTRAINT "attempts_ends_at_check" CHECK (
    "ends_at" > "started_at" AND "ends_at" <= "started_at" + interval '30 minutes'
  ),
  ADD CONSTRAINT "attempts_question_count_check" CHECK ("question_count" >= 1),
  ADD CONSTRAINT "attempts_content_version_check" CHECK ("content_version" >= 1),
  ADD CONSTRAINT "attempts_time_taken_check" CHECK (
    "time_taken_seconds" IS NULL OR "time_taken_seconds" BETWEEN 0 AND 1800
  ),
  ADD CONSTRAINT "attempts_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND "question_count"),
  ADD CONSTRAINT "attempts_submitted_at_check" CHECK (("status"::text = 'in_progress') = ("submitted_at" IS NULL)),
  ADD CONSTRAINT "attempts_scored_check" CHECK (("status"::text = 'scored') = ("score" IS NOT NULL));

-- The finalize sweep looks for attempts still running past their end (EXAM-PLAN 3.9).
CREATE INDEX "attempts_in_progress_ends_at_idx" ON "attempts" ("ends_at") WHERE "status" = 'in_progress';

-- The timer can never be reset, an attempt is never removed, and its status only moves forward.
CREATE FUNCTION "attempts_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attempts_guard: attempts are never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text <> 'in_progress' THEN
      RAISE EXCEPTION 'attempts_guard: a new attempt must be in_progress';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "exams" WHERE "id" = NEW."exam_id" AND "status"::text = 'published') THEN
      RAISE EXCEPTION 'attempts_guard: exam % is not published', NEW."exam_id";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."exam_id" IS DISTINCT FROM OLD."exam_id"
     OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
     OR NEW."ends_at" IS DISTINCT FROM OLD."ends_at"
     OR NEW."layout" IS DISTINCT FROM OLD."layout"
     OR NEW."question_count" IS DISTINCT FROM OLD."question_count"
     OR NEW."content_version" IS DISTINCT FROM OLD."content_version" THEN
    RAISE EXCEPTION 'attempts_guard: the timer and layout of attempt % cannot change', OLD."id";
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status"::text = 'in_progress' AND NEW."status"::text IN ('submitted', 'expired'))
    OR (OLD."status"::text IN ('submitted', 'expired') AND NEW."status"::text = 'scored')
  ) THEN
    RAISE EXCEPTION 'attempts_guard: attempt % cannot move from % to %', OLD."id", OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "attempts_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "attempts"
  FOR EACH ROW EXECUTE FUNCTION "attempts_guard"();

-- ───────────── submissions ─────────────

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_answers_check" CHECK (
    jsonb_typeof("answers") = 'object' AND COALESCE(jsonb_typeof("answers" -> 'a'), '') = 'array'
  ),
  ADD CONSTRAINT "submissions_request_id_check" CHECK ("request_id" ~ '^[A-Za-z0-9._-]{8,80}$'),
  ADD CONSTRAINT "submissions_violation_count_check" CHECK ("violation_count" >= 0),
  ADD CONSTRAINT "submissions_events_size_check" CHECK ("events" IS NULL OR pg_column_size("events") <= 16384);

-- Append-only, like audit_logs. TRUNCATE is refused too, except in a *_test database: the integration tests'
-- truncateAll empties users with CASCADE, which reaches attempts and submissions (EXAM-PLAN 2.2). A production
-- database is never named *_test (prepare-test-db.mjs uses the same rule).
CREATE FUNCTION "submissions_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND current_database() ~ '^[a-z0-9_]+_test$' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'submissions is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER "submissions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION "submissions_append_only"();

CREATE TRIGGER "submissions_no_truncate"
  BEFORE TRUNCATE ON "submissions"
  FOR EACH STATEMENT EXECUTE FUNCTION "submissions_append_only"();
