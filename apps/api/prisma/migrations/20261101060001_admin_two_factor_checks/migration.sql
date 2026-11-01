-- Admin two-factor login (DECISIONS "Admin two-factor login"): the shapes the API writes, held by the database too.
-- The secret is only ever stored sealed (`v1:<keyId 8 hex>:<iv>:<ciphertext>:<tag>`, base64url parts).
ALTER TABLE "user_two_factor"
  ADD CONSTRAINT "user_two_factor_secret_sealed_check"
    CHECK ("secret_ciphertext" ~ '^v1:[0-9a-f]{8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT "user_two_factor_last_step_check" CHECK ("last_step" IS NULL OR "last_step" >= 0),
  -- A step is only ever accepted on an enabled factor (enrolment confirms with a code, which sets both).
  ADD CONSTRAINT "user_two_factor_step_needs_enabled_check" CHECK ("last_step" IS NULL OR "enabled_at" IS NOT NULL);

-- Recovery codes are stored only as the SHA-256 hex of the normalised code.
ALTER TABLE "two_factor_recovery_codes"
  ADD CONSTRAINT "two_factor_recovery_codes_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
