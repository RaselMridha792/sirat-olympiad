-- Rounds and promotion (core C6a): the rules the API checks, kept by the database too. Hand-written: Prisma ignores
-- CHECKs when diffing. Enum columns are compared as ::text.
ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_name_check" CHECK (char_length("name") BETWEEN 2 AND 60),
  ADD CONSTRAINT "rounds_sort_order_check" CHECK ("sort_order" BETWEEN 1 AND 10),
  ADD CONSTRAINT "rounds_window_check" CHECK ("opens_at" IS NULL OR "closes_at" IS NULL OR "closes_at" > "opens_at"),
  ADD CONSTRAINT "rounds_criteria_check" CHECK (
    "criteria" IS NULL OR CASE WHEN jsonb_typeof("criteria") = 'array'
      THEN jsonb_array_length("criteria") BETWEEN 1 AND 20 ELSE false END),
  -- A video round always has its submission window and its jury criteria.
  ADD CONSTRAINT "rounds_video_check" CHECK (
    "type"::text <> 'video' OR ("criteria" IS NOT NULL AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL));

ALTER TABLE "round_entries"
  ADD CONSTRAINT "round_entries_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "round_entries_video_url_check" CHECK ("video_url" IS NULL OR char_length("video_url") <= 500),
  ADD CONSTRAINT "round_entries_video_check" CHECK (("video_url" IS NULL) = ("video_submitted_at" IS NULL));

ALTER TABLE "promotion_runs"
  ADD CONSTRAINT "promotion_runs_rounds_check" CHECK ("to_round_id" <> "from_round_id"),
  ADD CONSTRAINT "promotion_runs_top_n_check" CHECK ("top_n" BETWEEN 1 AND 25000),
  ADD CONSTRAINT "promotion_runs_counts_check" CHECK ("promoted_count" >= 0 AND "eliminated_count" >= 0),
  ADD CONSTRAINT "promotion_runs_source_check" CHECK (
    ("source_kind" = 'exam' AND "source_exam_id" IS NOT NULL AND "source_generation" >= 1)
    OR ("source_kind" = 'jury' AND "source_exam_id" IS NULL AND "source_generation" IS NULL));
