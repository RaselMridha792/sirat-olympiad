-- Ambassadors (docs/plans/CORE-PLAN.md section 6, C5a): the promo-code format payments' registration form accepts,
-- and the point ledger made append-only (deferred to this module by the A1 review). Hand-written: no schema change.
-- Prisma ignores CHECKs and triggers when diffing, so later migrations will not drop them. Names are explicit so the
-- tests can assert them.

-- The code a student types at registration (payments' StartRegistrationDto: ^[A-Za-z0-9_-]{3,40}$). The server
-- assigns codes; this keeps any other writer to the same alphabet. promo_code is CITEXT (case-insensitive unique).
ALTER TABLE "ambassador_profiles"
  ADD CONSTRAINT "ambassador_profiles_promo_code_format_check" CHECK ("promo_code"::text ~ '^[A-Za-z0-9_-]{3,40}$');

-- Points are an append-only ledger (RULEBOOK §19): totals and ranks are derived, corrections are new compensating
-- rows. UPDATE and DELETE are refused; TRUNCATE too, except in a *_test database, where the integration tests'
-- truncateAll empties users with CASCADE (as for submissions). A production database is never named *_test.
CREATE FUNCTION "point_ledger_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND current_database() ~ '^[a-z0-9_]+_test$' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'point_ledger is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER "point_ledger_no_update_delete"
  BEFORE UPDATE OR DELETE ON "point_ledger"
  FOR EACH ROW EXECUTE FUNCTION "point_ledger_append_only"();

CREATE TRIGGER "point_ledger_no_truncate"
  BEFORE TRUNCATE ON "point_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "point_ledger_append_only"();
