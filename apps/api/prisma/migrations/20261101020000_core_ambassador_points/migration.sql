-- Ambassador points (docs/plans/CORE-PLAN.md section 6, C5b; owner Q3 default, unanswered): points per paid referral.
-- Data only, insert-only: an admin's later value is never overwritten. No schema change. Rank thresholds are already
-- data (rank_thresholds, seeded with Bronze 0 / Silver 100 / Gold 250).
INSERT INTO "settings" ("key", "value", "created_at", "updated_at")
VALUES ('ambassador_points_per_referral', '10'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
