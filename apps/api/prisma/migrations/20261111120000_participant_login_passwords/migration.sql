-- Participant-ID login (owner decision 2026-11-10; docs/plans/PARTICIPANT-LOGIN-PLAN.md §4): students and ambassadors
-- log in with email + the participant ID on their admit card and have no password. Admin, manager and jury keep theirs.
-- Hand-written after payments' 20261110100000_registrations_participant_id: Prisma sees only the DROP NOT NULL.

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- No dead credentials: a student's or ambassador's password can no longer log in, so it goes. Before launch these
-- are fixtures, testers and demo accounts only; each has a registration, so a participant ID (payments' backfill).
UPDATE "users" SET "password_hash" = NULL WHERE "role"::text IN ('student', 'ambassador');

-- Their open password-reset links go too: a reset can no longer give them a password.
UPDATE "auth_tokens" t SET "used_at" = now()
  FROM "users" u
  WHERE t."user_id" = u."id" AND t."type"::text = 'password_reset' AND t."used_at" IS NULL
    AND u."role"::text IN ('student', 'ambassador');

-- Staff always have a password, so a role change to admin, manager or jury without one fails here. The reverse rule
-- (students and ambassadors have none) comes with payments' P2, once registration stops asking for a password.
ALTER TABLE "users" ADD CONSTRAINT "users_password_for_staff"
  CHECK ("password_hash" IS NOT NULL OR "role"::text IN ('student', 'ambassador'));
