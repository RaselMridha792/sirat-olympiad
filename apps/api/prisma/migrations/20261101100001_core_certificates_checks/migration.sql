-- Certificates (core C6c): the rules the API and the issue job keep, kept by the database too, and the serial's
-- sequence. Hand-written: Prisma ignores CHECKs when diffing. sirat_app gets USAGE on the sequence from the default
-- privileges (20261031224147_runtime_role).
CREATE SEQUENCE "certificate_serial_seq" AS bigint START 1;

ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_type_check" CHECK ("type" IN ('participation', 'promotion', 'winner')),
  -- SLO-<year>-<number from the sequence>, e.g. SLO-2026-000123.
  ADD CONSTRAINT "certificates_serial_check" CHECK ("serial" ~ '^SLO-[0-9]{4}-[0-9]{6,}$'),
  -- 12 random hex digits (48 bits), upper case: the public check's only key.
  ADD CONSTRAINT "certificates_verification_code_check" CHECK ("verification_code" ~ '^[0-9A-F]{12}$'),
  ADD CONSTRAINT "certificates_name_check" CHECK (char_length("name_on_certificate") BETWEEN 1 AND 200),
  -- Revoked means a time, an admin and a reason, all three or none.
  ADD CONSTRAINT "certificates_revoke_check" CHECK (
    ("revoked_at" IS NULL) = ("revoked_by_id" IS NULL) AND ("revoked_at" IS NULL) = ("revoke_reason" IS NULL)),
  ADD CONSTRAINT "certificates_revoke_reason_check" CHECK (
    "revoke_reason" IS NULL OR char_length("revoke_reason") BETWEEN 3 AND 200);
