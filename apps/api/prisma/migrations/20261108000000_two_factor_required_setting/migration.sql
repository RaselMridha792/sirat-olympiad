-- ───────────── settings ─────────────
-- The admin two-factor requirement (DECISIONS 2026-11-08 "The admin 2FA requirement is a setting"): the roles that must
-- prove a second factor on the admin routes, a JSON array within the enrollable roles ["admin","manager"] ([] = none).
-- The seed inserts the default ["admin","manager"] only while the row is missing, and the API reads a missing row the
-- same way (fail closed), so no data step here. Duplicates pass the CHECK; the API stores the set without them.
-- CASE fixes the evaluation order, as for the fee: the type test must come first, because a bare string is contained
-- in an array that holds it ('"admin"'::jsonb <@ '["admin","manager"]' is true), so <@ alone would accept "admin".
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_two_factor_required_roles_check" CHECK (
    "key" <> 'two_factor_required_roles'
    OR CASE
      WHEN jsonb_typeof("value") = 'array'
        THEN "value" <@ '["admin","manager"]'::jsonb
      ELSE false
    END
  );
