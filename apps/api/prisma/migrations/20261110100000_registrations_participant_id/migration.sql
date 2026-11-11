-- The participant ID (owner decision 10 Nov; DECISIONS "The participant ID"): printed on the admit card, emailed at
-- registration, and, with the email, the student's and ambassador's login (A2). Canonical form: the mode prefix ('ON'
-- online; 'OF' reserved for an offline mode) + 10 random digits + 1 Damm check digit, e.g. ON48210937552.
-- @sirat/shared participant-id.ts mirrors these rules (an int test cross-checks both ways).

-- Damm's interim digit over a string of decimal digits (the quasigroup of order 10): the check digit to append, or 0
-- when the string already ends with a valid one. Catches every single-digit error and every adjacent transposition.
CREATE FUNCTION "participant_damm"(p_digits text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = public, pg_temp AS $$
DECLARE
  t CONSTANT integer[] := ARRAY[
    [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
    [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
    [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
    [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
    [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
    [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
    [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
    [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
    [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
    [2, 5, 8, 1, 4, 3, 6, 7, 9, 0]];
  interim integer := 0;
BEGIN
  IF p_digits !~ '^[0-9]*$' THEN
    RAISE EXCEPTION 'participant_damm: digits only';
  END IF;
  FOR i IN 1 .. length(p_digits) LOOP
    interim := t[interim + 1][substr(p_digits, i, 1)::integer + 1];
  END LOOP;
  RETURN interim;
END
$$;

-- A canonical participant ID with a valid check digit.
CREATE FUNCTION "participant_id_check"(p_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT p_id ~ '^(ON|OF)[0-9]{11}$' AND participant_damm(substr(p_id, 3)) = 0
$$;

-- A new, unused participant ID. The 10 digits come from 48 bits of gen_random_uuid() (Postgres's strong random source,
-- pg_strong_random; never random(), a PRNG: the ID is a login secret); the modulo bias is below 4e-5. It draws again
-- while the value is taken; the UNIQUE index stays the backstop (a concurrent identical draw, about 1e-10).
CREATE FUNCTION "gen_participant_id"(p_prefix text DEFAULT 'ON') RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  body text;
  candidate text;
BEGIN
  IF p_prefix IS NULL OR p_prefix NOT IN ('ON', 'OF') THEN
    RAISE EXCEPTION 'gen_participant_id: unknown prefix %', p_prefix;
  END IF;
  LOOP
    body := lpad(
      (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 10000000000)::text,
      10, '0');
    candidate := p_prefix || body || participant_damm(body)::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "registrations" WHERE "participant_id" = candidate);
  END LOOP;
  RETURN candidate;
END
$$;

ALTER TABLE "registrations" ADD COLUMN "participant_id" TEXT;

-- Existing registrations, one row at a time, so each draw sees the ones before it. No offline mode exists: all 'ON'.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT "id" FROM "registrations" WHERE "participant_id" IS NULL ORDER BY "created_at", "id" LOOP
    UPDATE "registrations" SET "participant_id" = gen_participant_id('ON') WHERE "id" = r."id";
  END LOOP;
END
$$;

-- Every insert path gets one with no code change: settlement, the fixtures, the demo loader and the test helpers.
ALTER TABLE "registrations" ALTER COLUMN "participant_id" SET DEFAULT gen_participant_id();
ALTER TABLE "registrations" ALTER COLUMN "participant_id" SET NOT NULL;
CREATE UNIQUE INDEX "registrations_participant_id_key" ON "registrations"("participant_id");
ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_participant_id_check" CHECK (participant_id_check("participant_id"));
