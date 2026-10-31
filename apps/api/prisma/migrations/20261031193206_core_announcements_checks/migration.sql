-- Announcements: length CHECKs and the students' list index (docs/plans/CORE-PLAN.md section 5). Hand-written and kept
-- apart from the generated *_core_announcements migration, so regenerating that one never loses them. Prisma ignores
-- CHECKs and partial indexes when diffing, so later migrations will not drop them. Names are explicit so
-- test/core-constraints.int-spec.ts can assert them.

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_title_length_check" CHECK (char_length("title") BETWEEN 3 AND 150),
  ADD CONSTRAINT "announcements_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 5000),
  -- archived only after it was written; never before its own row existed
  ADD CONSTRAINT "announcements_archived_after_created_check" CHECK (
    "archived_at" IS NULL OR "archived_at" >= "created_at"
  );

-- The students' list: not archived, newest published first (queries must repeat the predicate to use it).
CREATE INDEX "announcements_live_published_idx" ON "announcements" ("published_at" DESC) WHERE "archived_at" IS NULL;
