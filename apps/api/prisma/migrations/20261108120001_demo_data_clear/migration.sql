-- Demo data (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"): the rules around the registry and
-- the one way demo rows are removed. Hand-written and kept apart from the generated migration. Names are explicit so
-- test/demo-data.int-spec.ts can assert them.
--
-- The model:
--   * a ROOT is a user, an exam or an announcement whose demo_batch_id is set. Only the demo loader writes that
--     column, at insert; a trigger refuses any later change, so an existing real row can never become a demo root;
--   * every row the loader inserts is also registered in demo_records (table name + id) in the same transaction;
--   * demo_clear(batch) (SECURITY DEFINER) is the only path that deletes demo rows from the guarded tables. It deletes
--     a row only when its root is registered for the batch AND marked with it, and the guarded tables' triggers let a
--     DELETE through only inside demo_clear (a transaction-local setting) and only for a row whose root is a
--     registered, marked demo root. So a forged registry row cannot delete a real attempt, submission, question or
--     answer-key correction, through the function or by a direct DELETE.

-- ───────────── the batch and the registry ─────────────

ALTER TABLE "demo_batches"
  ADD CONSTRAINT "demo_batches_status_check" CHECK ("status" IN ('loading', 'loaded', 'failed', 'clearing')),
  ADD CONSTRAINT "demo_batches_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 200);

-- At most one batch at a time (the API refuses a second load; this is the last line).
CREATE UNIQUE INDEX "demo_batches_one_at_a_time" ON "demo_batches" ((true));

ALTER TABLE "demo_records"
  ADD CONSTRAINT "demo_records_table_check" CHECK ("table_name" ~ '^[a-z_]{1,63}$'),
  ADD CONSTRAINT "demo_records_row_check" CHECK (char_length("row_id") BETWEEN 1 AND 64);

-- ───────────── roots ─────────────

-- A demo account carries the marker domain, and only a demo account does; never an admin or a manager. Emails are
-- stored lower-cased by every writer; lower() keeps the rule even if one did not.
ALTER TABLE "users"
  ADD CONSTRAINT "users_demo_email_check" CHECK (
    ("demo_batch_id" IS NULL) = (lower("email") NOT LIKE '%@demo.sirat.invalid')
  ),
  ADD CONSTRAINT "users_demo_role_check" CHECK (
    "demo_batch_id" IS NULL OR "role"::text IN ('student', 'ambassador', 'jury')
  );

-- The marker is written at insert and never changed: an existing row can neither become a demo root nor stop being one.
CREATE FUNCTION "demo_marker_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."demo_batch_id" IS DISTINCT FROM OLD."demo_batch_id" THEN
    RAISE EXCEPTION 'demo_marker_immutable: %.demo_batch_id cannot change', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "users_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();
CREATE TRIGGER "exams_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "exams"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();
CREATE TRIGGER "announcements_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "announcements"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();

-- Is this a registered, marked demo root? (Both, always: the marker alone or the registry alone is not enough.)
CREATE FUNCTION "demo_user_root"(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "users" u JOIN "demo_records" r
      ON r."table_name" = 'users' AND r."row_id" = u."id"::text AND r."batch_id" = u."demo_batch_id"
    WHERE u."id" = p_id AND u."demo_batch_id" IS NOT NULL)
$$;

CREATE FUNCTION "demo_exam_root"(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "exams" e JOIN "demo_records" r
      ON r."table_name" = 'exams' AND r."row_id" = e."id"::text AND r."batch_id" = e."demo_batch_id"
    WHERE e."id" = p_id AND e."demo_batch_id" IS NOT NULL)
$$;

-- True only inside demo_clear (a transaction-local setting it sets itself).
CREATE FUNCTION "demo_clearing"() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('sirat.demo_clear', true), '') = 'on'
$$;

-- ───────────── the guarded tables let demo_clear through, and nothing else ─────────────

CREATE OR REPLACE FUNCTION "attempts_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "demo_clearing"() AND ("demo_user_root"(OLD."user_id") OR "demo_exam_root"(OLD."exam_id")) THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION "questions_frozen_after_publish"() RETURNS trigger
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
  IF TG_OP = 'DELETE' AND "demo_clearing"() AND "demo_exam_root"(OLD."exam_id") THEN
    RETURN OLD;
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

CREATE OR REPLACE FUNCTION "submissions_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND current_database() ~ '^[a-z0-9_]+_test$' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' AND "demo_clearing"() AND EXISTS (
       SELECT 1 FROM "attempts" a
       WHERE a."id" = OLD."attempt_id" AND ("demo_user_root"(a."user_id") OR "demo_exam_root"(a."exam_id"))) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'submissions is append-only: % is not allowed', TG_OP;
END
$$;

CREATE OR REPLACE FUNCTION "answer_key_corrections_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND right(current_database(), 5) = '_test' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' AND "demo_clearing"() AND "demo_exam_root"(OLD."exam_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'answer_key_corrections is append-only: % is not allowed', TG_OP;
END
$$;

-- ───────────── demo_clear: the one way demo rows go ─────────────

-- Deletes everything batch p_batch made, children first, then the registry and the batch; returns the counts. Only
-- roots registered for the batch AND marked with it count, and every other row goes only through such a root (its
-- user, its exam, its attempt), or, for a registered row of payments' registration form, its marker email. Idempotent:
-- an unknown or already removed batch returns {}. point_ledger, jury_scores and promotion_runs (append-only) are not
-- touched yet: a demo user with rows there makes the user's delete fail (RESTRICT), and the whole call rolls back.
CREATE FUNCTION "demo_clear"(p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_users uuid[];
  v_exams uuid[];
  v_notes uuid[];
  v_attempts uuid[];
  v_forms uuid[];
  counts jsonb := '{}'::jsonb;
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "demo_batches" WHERE "id" = p_batch) THEN
    RETURN counts;
  END IF;
  PERFORM set_config('sirat.demo_clear', 'on', true);

  -- The roots: registered for this batch AND marked with it.
  SELECT coalesce(array_agg(u."id"), '{}') INTO v_users FROM "users" u JOIN "demo_records" r
    ON r."table_name" = 'users' AND r."row_id" = u."id"::text AND r."batch_id" = p_batch
    WHERE u."demo_batch_id" = p_batch;
  SELECT coalesce(array_agg(e."id"), '{}') INTO v_exams FROM "exams" e JOIN "demo_records" r
    ON r."table_name" = 'exams' AND r."row_id" = e."id"::text AND r."batch_id" = p_batch
    WHERE e."demo_batch_id" = p_batch;
  SELECT coalesce(array_agg(a."id"), '{}') INTO v_notes FROM "announcements" a JOIN "demo_records" r
    ON r."table_name" = 'announcements' AND r."row_id" = a."id"::text AND r."batch_id" = p_batch
    WHERE a."demo_batch_id" = p_batch;
  -- Attempts of a demo user or on a demo exam (also those made after the load, e.g. a demo student's own try).
  SELECT coalesce(array_agg("id"), '{}') INTO v_attempts FROM "attempts"
    WHERE "user_id" = ANY (v_users) OR "exam_id" = ANY (v_exams);
  -- Payments' registration forms: a demo user's, or a registered one with the marker email (an open demo form has no
  -- user yet; registration refuses the marker domain, so no real form carries it).
  SELECT coalesce(array_agg(p."id"), '{}') INTO v_forms FROM "pending_registrations" p
    WHERE p."user_id" = ANY (v_users)
       OR (lower(p."email") LIKE '%@demo.sirat.invalid' AND EXISTS (
             SELECT 1 FROM "demo_records" r
             WHERE r."table_name" = 'pending_registrations' AND r."row_id" = p."id"::text AND r."batch_id" = p_batch));

  DELETE FROM "leaderboard_entries" WHERE "exam_id" = ANY (v_exams) OR "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('leaderboard_entries', n);
  DELETE FROM "answer_key_corrections" WHERE "exam_id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('answer_key_corrections', n);
  DELETE FROM "submissions" WHERE "attempt_id" = ANY (v_attempts);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('submissions', n);
  DELETE FROM "attempts" WHERE "id" = ANY (v_attempts);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('attempts', n);
  DELETE FROM "questions" WHERE "exam_id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('questions', n);

  -- Rows a demo user owns in the other areas (none are made by the load before phase 2; a demo account may make some
  -- after it). Each goes through its user only.
  DELETE FROM "certificates" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('certificates', n);
  DELETE FROM "task_assignments" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('task_assignments', n);
  DELETE FROM "team_members" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('team_members', n);
  DELETE FROM "teams" WHERE "owner_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('teams', n);
  DELETE FROM "jury_assignments" WHERE "judge_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('jury_assignments', n);
  DELETE FROM "round_entries" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('round_entries', n);
  DELETE FROM "ambassador_profiles" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ambassador_profiles', n);

  -- Payments (payments' order): book orders, registrations, payments, the registration forms.
  DELETE FROM "book_orders" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('book_orders', n);
  DELETE FROM "registrations" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('registrations', n);
  DELETE FROM "payments" WHERE "user_id" = ANY (v_users) OR "pending_registration_id" = ANY (v_forms);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('payments', n);
  DELETE FROM "pending_registrations" WHERE "id" = ANY (v_forms);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('pending_registrations', n);

  DELETE FROM "announcements" WHERE "id" = ANY (v_notes);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('announcements', n);
  DELETE FROM "exams" WHERE "id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('exams', n);
  -- Sessions, auth tokens and two-factor rows go with their user (ON DELETE CASCADE).
  DELETE FROM "users" WHERE "id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('users', n);

  DELETE FROM "demo_records" WHERE "batch_id" = p_batch;
  DELETE FROM "demo_batches" WHERE "id" = p_batch;
  -- Closed again, so nothing later in the caller's transaction runs with it.
  PERFORM set_config('sirat.demo_clear', '', true);
  RETURN counts;
END
$$;

-- Only the runtime role may call it (and the owner, who made it). Guarded like the runtime_role migration, for a
-- database where the role does not exist.
REVOKE ALL ON FUNCTION "demo_clear"(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    GRANT EXECUTE ON FUNCTION "demo_clear"(uuid) TO sirat_app;
    -- The registry is written by the loader and removed only by demo_clear (as the owner).
    REVOKE UPDATE, DELETE ON TABLE "demo_records" FROM sirat_app;
    REVOKE DELETE ON TABLE "demo_batches" FROM sirat_app;
  END IF;
END
$$;
