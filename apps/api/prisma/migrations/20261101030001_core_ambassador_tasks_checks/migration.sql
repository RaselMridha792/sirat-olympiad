-- Ambassador tasks (docs/plans/CORE-PLAN.md section 6, C5b-2): the limits the API checks, kept by the database too,
-- and the status rules. Hand-written: Prisma ignores CHECKs when diffing, so later migrations will not drop them.
-- Enum columns are compared as ::text (05-DATABASE: enum-literal CHECKs break Prisma enum migrations).
ALTER TABLE "admin_tasks"
  ADD CONSTRAINT "admin_tasks_title_check" CHECK (char_length("title") BETWEEN 3 AND 120),
  ADD CONSTRAINT "admin_tasks_description_check" CHECK (char_length("description") BETWEEN 1 AND 2000),
  ADD CONSTRAINT "admin_tasks_points_check" CHECK ("points" BETWEEN 0 AND 1000),
  ADD CONSTRAINT "admin_tasks_archived_at_check" CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at");

ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_proof_text_check"
    CHECK ("proof_text" IS NULL OR char_length("proof_text") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "task_assignments_review_note_check"
    CHECK ("review_note" IS NULL OR char_length("review_note") BETWEEN 1 AND 500),
  -- Submitted (and every later state) carries the proof and its time.
  ADD CONSTRAINT "task_assignments_submitted_check"
    CHECK ("status"::text = 'assigned' OR ("proof_text" IS NOT NULL AND "submitted_at" IS NOT NULL)),
  -- Approved exactly when an admin and a time are recorded; approval is final (the API never leaves it).
  ADD CONSTRAINT "task_assignments_approved_check"
    CHECK (("status"::text = 'approved') = ("approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL)),
  ADD CONSTRAINT "task_assignments_rejected_check"
    CHECK ("status"::text <> 'rejected' OR "review_note" IS NOT NULL);
