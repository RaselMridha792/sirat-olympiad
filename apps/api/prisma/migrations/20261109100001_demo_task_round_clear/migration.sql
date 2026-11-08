-- Demo data, phase 2 (DECISIONS 2026-11-08 "Demo data"; the lead's plan approval D1 and D3, core's approval).
-- admin_tasks and rounds become demo roots like users, exams and announcements: demo_batch_id is written only by the
-- loader at insert (the trigger below refuses any change) and counts only together with the registry (demo_records).
-- demo_clear v3 removes demo tasks and demo rounds after everything that hangs off them, and refuses (deleting nothing)
-- while a real row sits on a demo task or a demo round. A promotion run from or into a demo round is a demo run.
-- certificate_serial_seq stops at 899999: demo certificates use SLO-YYYY-9NNNNN, which a real serial never reaches.
-- Demo rounds order among themselves in 101-110, real rounds keep 1-10 (A2's review): the two sides never meet on the
-- unique sort_order, and "the next round" or "max + 1" over real rounds can never land on a demo one.

CREATE TRIGGER "admin_tasks_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "admin_tasks"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();
CREATE TRIGGER "rounds_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "rounds"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();

CREATE FUNCTION "demo_round_root"(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "rounds" o JOIN "demo_records" r
      ON r."table_name" = 'rounds' AND r."row_id" = o."id"::text AND r."batch_id" = o."demo_batch_id"
    WHERE o."id" = p_id AND o."demo_batch_id" IS NOT NULL)
$$;

-- A promotion run is a demo row when its source exam is a demo root, when it runs from or into a demo round, or when
-- every entry it made belongs to a demo user.
CREATE OR REPLACE FUNCTION "demo_run_root"(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "promotion_runs" pr
    WHERE pr."id" = p_id
      AND ((pr."source_exam_id" IS NOT NULL AND "demo_exam_root"(pr."source_exam_id"))
        OR "demo_round_root"(pr."from_round_id") OR "demo_round_root"(pr."to_round_id")
        OR (EXISTS (SELECT 1 FROM "round_entries" e WHERE e."promotion_run_id" = pr."id")
            AND NOT EXISTS (SELECT 1 FROM "round_entries" e
                            WHERE e."promotion_run_id" = pr."id" AND NOT "demo_user_root"(e."user_id")))))
$$;

-- v3: v2 plus demo tasks and demo rounds (their blockers, then their rows). CREATE OR REPLACE keeps the owner and the
-- grants; they are asserted again below anyway.
CREATE OR REPLACE FUNCTION "demo_clear"(p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_users uuid[];
  v_exams uuid[];
  v_notes uuid[];
  v_attempts uuid[];
  v_forms uuid[];
  v_runs uuid[];
  v_entries uuid[];
  v_teams uuid[];
  v_tasks uuid[];
  v_rounds uuid[];
  blockers jsonb := '{}'::jsonb;
  counts jsonb := '{}'::jsonb;
  n integer;
BEGIN
  SELECT "status" INTO v_status FROM "demo_batches" WHERE "id" = p_batch FOR UPDATE;
  IF NOT FOUND THEN
    RETURN counts;
  END IF;
  IF v_status = 'loading' THEN
    RAISE EXCEPTION 'demo_clear_busy: batch % is still loading', p_batch;
  END IF;

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
  SELECT coalesce(array_agg(t."id"), '{}') INTO v_tasks FROM "admin_tasks" t JOIN "demo_records" r
    ON r."table_name" = 'admin_tasks' AND r."row_id" = t."id"::text AND r."batch_id" = p_batch
    WHERE t."demo_batch_id" = p_batch;
  SELECT coalesce(array_agg(o."id"), '{}') INTO v_rounds FROM "rounds" o JOIN "demo_records" r
    ON r."table_name" = 'rounds' AND r."row_id" = o."id"::text AND r."batch_id" = p_batch
    WHERE o."demo_batch_id" = p_batch;
  -- What hangs off them.
  SELECT coalesce(array_agg("id"), '{}') INTO v_attempts FROM "attempts"
    WHERE "user_id" = ANY (v_users) AND "exam_id" = ANY (v_exams);
  SELECT coalesce(array_agg(p."id"), '{}') INTO v_forms FROM "pending_registrations" p
    WHERE p."user_id" = ANY (v_users)
       OR (lower(p."email") LIKE '%@demo.sirat.invalid' AND EXISTS (
             SELECT 1 FROM "demo_records" r
             WHERE r."table_name" = 'pending_registrations' AND r."row_id" = p."id"::text AND r."batch_id" = p_batch));
  SELECT coalesce(array_agg(pr."id"), '{}') INTO v_runs FROM "promotion_runs" pr
    WHERE pr."source_exam_id" = ANY (v_exams)
       OR pr."from_round_id" = ANY (v_rounds) OR pr."to_round_id" = ANY (v_rounds)
       OR (EXISTS (SELECT 1 FROM "round_entries" e WHERE e."promotion_run_id" = pr."id")
           AND NOT EXISTS (SELECT 1 FROM "round_entries" e
                           WHERE e."promotion_run_id" = pr."id" AND NOT (e."user_id" = ANY (v_users))));
  SELECT coalesce(array_agg("id"), '{}') INTO v_entries FROM "round_entries" WHERE "user_id" = ANY (v_users);
  SELECT coalesce(array_agg("id"), '{}') INTO v_teams FROM "teams" WHERE "owner_id" = ANY (v_users);

  -- Blockers: a real row pointing at a demo root, or a demo row pointing into real data. Nothing is deleted then.
  SELECT count(*) INTO n FROM "attempts" WHERE "exam_id" = ANY (v_exams) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_attempts_on_demo_exams', n); END IF;
  SELECT count(*) INTO n FROM "attempts" WHERE "user_id" = ANY (v_users) AND NOT ("exam_id" = ANY (v_exams));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('demo_attempts_on_real_exams', n); END IF;
  SELECT count(*) INTO n FROM "leaderboard_entries"
    WHERE "user_id" = ANY (v_users) AND NOT ("exam_id" = ANY (v_exams));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('demo_users_on_real_leaderboards', n); END IF;
  SELECT count(*) INTO n FROM "users" WHERE "referred_by_id" = ANY (v_users) AND NOT ("id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_users_referred_by_demo', n); END IF;
  SELECT count(*) INTO n FROM "pending_registrations"
    WHERE "referred_by_id" = ANY (v_users) AND NOT ("id" = ANY (v_forms));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_forms_referred_by_demo', n); END IF;
  SELECT count(*) INTO n FROM "team_members"
    WHERE ("team_id" = ANY (v_teams) AND NOT ("user_id" = ANY (v_users)))
       OR ("user_id" = ANY (v_users) AND NOT ("team_id" = ANY (v_teams)));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('mixed_team_members', n); END IF;
  SELECT count(*) INTO n FROM "round_entries"
    WHERE "promotion_run_id" = ANY (v_runs) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_entries_from_demo_promotions', n); END IF;
  SELECT count(*) INTO n FROM "jury_scores" s
    WHERE ("judge_id" = ANY (v_users) AND NOT ("entry_id" = ANY (v_entries)))
       OR ("entry_id" = ANY (v_entries) AND NOT ("judge_id" = ANY (v_users)));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('mixed_jury_scores', n); END IF;
  -- Phase 2: real rows on a demo task or a demo round.
  SELECT count(*) INTO n FROM "task_assignments"
    WHERE "task_id" = ANY (v_tasks) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_assignments_on_demo_tasks', n); END IF;
  SELECT count(*) INTO n FROM "point_ledger"
    WHERE "task_id" = ANY (v_tasks) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_points_on_demo_tasks', n); END IF;
  SELECT count(*) INTO n FROM "round_entries"
    WHERE "round_id" = ANY (v_rounds) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_entries_on_demo_rounds', n); END IF;
  SELECT count(*) INTO n FROM "exams"
    WHERE "round_id" = ANY (v_rounds) AND NOT ("id" = ANY (v_exams));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_exams_on_demo_rounds', n); END IF;
  SELECT count(*) INTO n FROM "jury_assignments"
    WHERE "round_id" = ANY (v_rounds) AND NOT ("judge_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_jury_on_demo_rounds', n); END IF;
  SELECT count(*) INTO n FROM "certificates"
    WHERE "round_id" = ANY (v_rounds) AND NOT ("user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_certificates_on_demo_rounds', n); END IF;
  IF blockers <> '{}'::jsonb THEN
    RAISE EXCEPTION 'demo_clear_blocked: %', blockers::text;
  END IF;

  PERFORM set_config('sirat.demo_clear', 'on', true);

  DELETE FROM "leaderboard_entries" WHERE "exam_id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('leaderboard_entries', n);
  DELETE FROM "answer_key_corrections" WHERE "exam_id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('answer_key_corrections', n);
  DELETE FROM "submissions" WHERE "attempt_id" = ANY (v_attempts);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('submissions', n);
  DELETE FROM "attempts" WHERE "id" = ANY (v_attempts);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('attempts', n);

  -- Rounds: scores on demo entries, the demo entries, then the demo promotion runs.
  DELETE FROM "jury_scores" WHERE "entry_id" = ANY (v_entries);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('jury_scores', n);
  DELETE FROM "round_entries" WHERE "id" = ANY (v_entries);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('round_entries', n);
  DELETE FROM "promotion_runs" WHERE "id" = ANY (v_runs);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('promotion_runs', n);
  DELETE FROM "jury_assignments" WHERE "judge_id" = ANY (v_users) OR "round_id" = ANY (v_rounds);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('jury_assignments', n);
  DELETE FROM "questions" WHERE "exam_id" = ANY (v_exams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('questions', n);

  -- Rows a demo user owns in the other areas, each through its user only.
  DELETE FROM "certificates" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('certificates', n);
  DELETE FROM "point_ledger" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('point_ledger', n);
  DELETE FROM "task_assignments" WHERE "user_id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('task_assignments', n);
  -- Demo tasks, once their assignments and points (all demo users', by the blockers) are gone.
  DELETE FROM "admin_tasks" WHERE "id" = ANY (v_tasks);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('admin_tasks', n);
  DELETE FROM "team_members" WHERE "team_id" = ANY (v_teams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('team_members', n);
  DELETE FROM "teams" WHERE "id" = ANY (v_teams);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('teams', n);
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
  -- Demo rounds, once their entries, runs, jury assignments, certificates and exams are gone.
  DELETE FROM "rounds" WHERE "id" = ANY (v_rounds);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('rounds', n);
  -- Sessions, auth tokens and two-factor rows go with their user (ON DELETE CASCADE): all the demo user's own.
  DELETE FROM "users" WHERE "id" = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('users', n);

  DELETE FROM "demo_records" WHERE "batch_id" = p_batch;
  DELETE FROM "demo_batches" WHERE "id" = p_batch;
  -- Closed again, so nothing later in the caller's transaction runs with it.
  PERFORM set_config('sirat.demo_clear', '', true);
  RETURN counts;
END
$$;

REVOKE ALL ON FUNCTION "demo_clear"(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    GRANT EXECUTE ON FUNCTION "demo_clear"(uuid) TO sirat_app;
  END IF;
END
$$;

ALTER SEQUENCE "certificate_serial_seq" MAXVALUE 899999;

ALTER TABLE "rounds" DROP CONSTRAINT "rounds_sort_order_check",
  ADD CONSTRAINT "rounds_sort_order_check" CHECK (
    ("demo_batch_id" IS NULL AND "sort_order" BETWEEN 1 AND 10)
    OR ("demo_batch_id" IS NOT NULL AND "sort_order" BETWEEN 101 AND 110));
