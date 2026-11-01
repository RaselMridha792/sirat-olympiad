-- Admin two-factor login (DECISIONS "Admin two-factor login"): what the session family itself proved. True only when
-- it started after the login's code step or after enable with a code; a refresh copies it (and the user must still
-- be enrolled) and never raises it, so no session can claim a factor it did not prove. Existing rows: false, as their
-- access tokens never carried the proof either. Adding a column with a constant default rewrites nothing.
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "two_factor_verified" BOOLEAN NOT NULL DEFAULT false;
