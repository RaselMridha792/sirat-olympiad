-- Admin two-factor login (DECISIONS "Admin two-factor login"): codes tried on a PENDING factor. Each enable attempt
-- reserves one before its code is checked (so parallel guesses cannot pass the cap); the 5th wrong code deletes the
-- pending row, and setup (which asks for the password) must run again. A new setup and a right code reset it.
-- AlterTable
ALTER TABLE "user_two_factor" ADD COLUMN     "enable_attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "user_two_factor"
  ADD CONSTRAINT "user_two_factor_enable_attempts_check" CHECK ("enable_attempts" BETWEEN 0 AND 5),
  -- Only a pending factor counts attempts: enable sets it back to 0 together with enabled_at.
  ADD CONSTRAINT "user_two_factor_attempts_only_pending_check" CHECK ("enable_attempts" = 0 OR "enabled_at" IS NULL);
