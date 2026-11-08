-- Demo data, phase 2: core's backstops (DECISIONS 2026-11-08 "Demo data"; the lead's approval of 2026-11-09). The
-- services refuse first (task_side_mismatch, demo_rounds_present, jury_side_mismatch); these triggers stop a row the
-- services would never write, whoever writes it.
-- * task_assignments: a demo task goes only to a demo account and a real task only to a real one.
-- * round_entries: an account enters only a round of its side. Demo data has its own Round 1 (sort orders 101-110),
--   so no demo row points at a real round (the lead, 2026-11-09).
-- The markers are immutable (demo_marker_immutable), so a row checked here stays on its side. A missing task, user or
-- round is left to the foreign key.

CREATE FUNCTION "task_assignments_same_side"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  task_demo boolean;
  user_demo boolean;
BEGIN
  SELECT t."demo_batch_id" IS NOT NULL INTO task_demo FROM "admin_tasks" t WHERE t."id" = NEW."task_id";
  SELECT u."demo_batch_id" IS NOT NULL INTO user_demo FROM "users" u WHERE u."id" = NEW."user_id";
  IF task_demo IS NOT NULL AND user_demo IS NOT NULL AND task_demo <> user_demo THEN
    RAISE EXCEPTION 'task_side_mismatch: a demo task goes only to demo accounts, a real task only to real ones'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "task_assignments_same_side" BEFORE INSERT OR UPDATE OF "task_id", "user_id" ON "task_assignments"
  FOR EACH ROW EXECUTE FUNCTION "task_assignments_same_side"();

CREATE FUNCTION "round_entries_same_side"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  round_demo boolean;
  user_demo boolean;
BEGIN
  SELECT r."demo_batch_id" IS NOT NULL INTO round_demo FROM "rounds" r WHERE r."id" = NEW."round_id";
  SELECT u."demo_batch_id" IS NOT NULL INTO user_demo FROM "users" u WHERE u."id" = NEW."user_id";
  IF round_demo IS NOT NULL AND user_demo IS NOT NULL AND round_demo <> user_demo THEN
    RAISE EXCEPTION 'round_side_mismatch: a demo account enters only demo rounds, a real account only real ones'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "round_entries_same_side" BEFORE INSERT OR UPDATE OF "round_id", "user_id" ON "round_entries"
  FOR EACH ROW EXECUTE FUNCTION "round_entries_same_side"();
