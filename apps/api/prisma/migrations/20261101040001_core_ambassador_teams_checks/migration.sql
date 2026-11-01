-- Teams (core C5b-3): the limits the API checks, kept by the database too. Hand-written: Prisma ignores CHECKs when
-- diffing. The 10-member cap is checked by the join transaction under a row lock on the team (no trigger).
ALTER TABLE "teams"
  ADD CONSTRAINT "teams_name_check" CHECK (char_length("name"::text) BETWEEN 3 AND 60),
  ADD CONSTRAINT "teams_join_code_format_check" CHECK ("join_code"::text ~ '^TM-[0-9A-HJKMNP-TV-Z]{6}$');
