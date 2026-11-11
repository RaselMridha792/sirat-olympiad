-- Discount codes (DECISIONS "Discount codes"; payments D1, the lead's approval of 10 Nov). An admin-made code takes an
-- amount or a percentage off the registration fee; the server prices the registration at start and snapshots the
-- price on the attempt (retry and resume reuse it) and on each payment. The amount to pay never goes below 10 BDT.
-- discount_codes is a demo root like admin_tasks (demo_batch_id, written only by the loader, immutable), and
-- demo_clear v4 removes demo codes after the forms and payments that used them.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "discount_code_id" UUID,
ADD COLUMN     "discount_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "list_amount_minor" INTEGER;

-- AlterTable
ALTER TABLE "pending_registrations" ADD COLUMN     "amount_minor" INTEGER,
ADD COLUMN     "discount_code_id" UUID,
ADD COLUMN     "discount_minor" INTEGER,
ADD COLUMN     "list_amount_minor" INTEGER;

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "max_uses" INTEGER,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ambassador_user_id" UUID,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "demo_batch_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_ambassador_user_id_idx" ON "discount_codes"("ambassador_user_id");

-- CreateIndex
CREATE INDEX "discount_codes_created_by_id_idx" ON "discount_codes"("created_by_id");

-- CreateIndex
CREATE INDEX "discount_codes_demo_batch_id_idx" ON "discount_codes"("demo_batch_id");

-- CreateIndex
CREATE INDEX "payments_discount_code_id_status_idx" ON "payments"("discount_code_id", "status");

-- CreateIndex
CREATE INDEX "pending_registrations_discount_code_id_idx" ON "pending_registrations"("discount_code_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_ambassador_user_id_fkey" FOREIGN KEY ("ambassador_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The code: canonical upper case, 4-20 of A-Z 0-9 and "-", never an ambassador's (SR-) or a team's (TM-) prefix, so the
-- one promo field can tell them apart by the prefix alone.
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_code_check"
  CHECK ("code"::text ~ '^[A-Z0-9-]{4,20}$' AND "code"::text !~ '^(SR|TM)-');
-- amount: whole taka in paisa; percent: 1-99 (never a free registration). kind is text, not an enum: these CHECKs
-- compare it to literals (db-constraints.int-spec forbids that for enums).
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_value_check" CHECK (
  ("kind" = 'amount' AND "value" > 0 AND "value" % 100 = 0) OR ("kind" = 'percent' AND "value" BETWEEN 1 AND 99));
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_max_uses_check"
  CHECK ("max_uses" IS NULL OR "max_uses" > 0);
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_window_check"
  CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_note_check"
  CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200);

CREATE TRIGGER "discount_codes_demo_marker_immutable" BEFORE UPDATE OF "demo_batch_id" ON "discount_codes"
  FOR EACH ROW EXECUTE FUNCTION "demo_marker_immutable"();

-- The attempt's price snapshot: all three or none (none = an attempt made before discount codes); payable = list -
-- discount, whole taka; with a discount actually given, a code and never below 10 BDT.
ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_price_check" CHECK (
  ("list_amount_minor" IS NULL AND "discount_minor" IS NULL AND "amount_minor" IS NULL AND "discount_code_id" IS NULL)
  OR ("list_amount_minor" IS NOT NULL AND "discount_minor" IS NOT NULL AND "amount_minor" IS NOT NULL
      AND "discount_minor" >= 0 AND "discount_minor" % 100 = 0 AND "amount_minor" > 0
      AND "amount_minor" = "list_amount_minor" - "discount_minor"
      AND ("discount_minor" = 0 OR ("discount_code_id" IS NOT NULL AND "amount_minor" >= 1000))));

-- The payment's: before discount codes, no list amount, no discount and no code; after, amount = list - discount.
ALTER TABLE "payments" ADD CONSTRAINT "payments_discount_check" CHECK (
  "discount_minor" >= 0 AND "discount_minor" % 100 = 0
  AND (("list_amount_minor" IS NULL AND "discount_minor" = 0 AND "discount_code_id" IS NULL)
       OR ("list_amount_minor" IS NOT NULL AND "amount_minor" = "list_amount_minor" - "discount_minor"))
  AND ("discount_minor" = 0 OR ("discount_code_id" IS NOT NULL AND "amount_minor" >= 1000)));

-- v4: v3 plus demo discount codes (their blockers, then their rows). CREATE OR REPLACE keeps the owner and the
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
  v_codes uuid[];
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
  SELECT coalesce(array_agg(c."id"), '{}') INTO v_codes FROM "discount_codes" c JOIN "demo_records" r
    ON r."table_name" = 'discount_codes' AND r."row_id" = c."id"::text AND r."batch_id" = p_batch
    WHERE c."demo_batch_id" = p_batch;
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
  -- v4, discount codes (payments D1): a real form, payment or code pointing at a demo code or a demo ambassador, or a
  -- demo payment or code pointing at a real code or a real ambassador. A payment belongs to the demo side when its
  -- form or its account does (the same rows the payments delete below takes).
  SELECT count(*) INTO n FROM "pending_registrations"
    WHERE "discount_code_id" = ANY (v_codes) AND NOT ("id" = ANY (v_forms));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_forms_on_demo_codes', n); END IF;
  SELECT count(*) INTO n FROM "payments"
    WHERE "discount_code_id" = ANY (v_codes)
      AND NOT ("pending_registration_id" = ANY (v_forms) OR ("user_id" IS NOT NULL AND "user_id" = ANY (v_users)));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_payments_on_demo_codes', n); END IF;
  SELECT count(*) INTO n FROM "payments"
    WHERE ("pending_registration_id" = ANY (v_forms) OR ("user_id" IS NOT NULL AND "user_id" = ANY (v_users)))
      AND "discount_code_id" IS NOT NULL AND NOT ("discount_code_id" = ANY (v_codes));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('demo_payments_on_real_codes', n); END IF;
  SELECT count(*) INTO n FROM "discount_codes"
    WHERE "ambassador_user_id" = ANY (v_users) AND NOT ("id" = ANY (v_codes));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('real_codes_linked_to_demo', n); END IF;
  SELECT count(*) INTO n FROM "discount_codes"
    WHERE "id" = ANY (v_codes) AND "ambassador_user_id" IS NOT NULL AND NOT ("ambassador_user_id" = ANY (v_users));
  IF n > 0 THEN blockers := blockers || jsonb_build_object('demo_codes_linked_to_real', n); END IF;
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
  -- v4: demo discount codes, once the forms and payments that used them are gone (all demo ones, by the blockers).
  DELETE FROM "discount_codes" WHERE "id" = ANY (v_codes);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('discount_codes', n);

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
