-- Payment and registration rules that Prisma cannot express (docs/plans/PAYMENTS-PLAN.md section 4.2, M3). Kept apart
-- from the generated M1 so regenerating M1 never loses them. Prisma ignores CHECKs, triggers and partial indexes when
-- diffing, so later migrations will not drop them. Names are explicit so integration tests can assert them.
--
-- Enums: CHECK constraints compare `::text` (an enum literal in a CHECK breaks Prisma's enum migrations; the
-- schema-invariant test enforces it). Partial index predicates cannot do that (Postgres requires IMMUTABLE functions
-- there and the enum-to-text cast is only STABLE), so they compare enum literals. A future migration that RECREATES
-- "PaymentStatus" or "RegistrationAttemptStatus" (removing or renaming a value; adding one is fine) must drop and
-- recreate payments_one_active_per_attempt, pending_registrations_one_open_per_email and _per_phone around it.

-- ───────────── payments ─────────────
-- Whole taka (PayStation takes integers), BDT only, paid means PayStation reported exactly our amount
-- (pay_with_charge = 0: the merchant bears the charge, DECISIONS "Gateway charge"), our invoice format, no empty trx.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_whole_taka_check" CHECK ("amount_minor" % 100 = 0),
  ADD CONSTRAINT "payments_currency_check" CHECK ("currency" = 'BDT'),
  ADD CONSTRAINT "payments_paid_amount_check" CHECK (
    "status"::text <> 'paid' OR "paid_amount_minor" IS NOT DISTINCT FROM "amount_minor"
  ),
  ADD CONSTRAINT "payments_invoice_number_check" CHECK ("invoice_number" ~ '^[A-Z0-9]{10,20}$'),
  ADD CONSTRAINT "payments_trx_id_check" CHECK ("trx_id" <> ''),
  ADD CONSTRAINT "payments_gateway_account_check" CHECK ("gateway_account" ~ '^[a-z0-9-]{3,32}$'),
  ADD CONSTRAINT "payments_check_count_check" CHECK ("check_count" >= 0);

-- One active checkout per attempt: a second payment can only start after the previous one is final.
CREATE UNIQUE INDEX "payments_one_active_per_attempt" ON "payments" ("pending_registration_id")
  WHERE "status" IN ('initiated', 'pending');

-- Status changes follow the state machine (plan section 5). A new row is always `initiated`. `refunded` is never
-- entered: there is no refund handling (DECISIONS "No refund handling", owner).
CREATE FUNCTION payments_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text <> 'initiated' THEN
      RAISE EXCEPTION 'payments: a new payment must start as initiated (got %)', NEW."status";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF (OLD."status"::text, NEW."status"::text) IN (
    ('initiated', 'pending'), ('initiated', 'failed'),
    ('pending', 'paid'), ('pending', 'failed'), ('pending', 'expired'),
    ('failed', 'paid'), ('expired', 'paid')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payments: status % -> % is not allowed', OLD."status", NEW."status";
END
$$;

CREATE TRIGGER payments_status_transition
  BEFORE INSERT OR UPDATE OF "status" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_status_transition();

-- ───────────── registrations ─────────────
-- A registration exists only for a paid payment of the same user (the Phase C item deferred in the A1 review).
CREATE FUNCTION registrations_payment_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payments" p
    WHERE p."id" = NEW."payment_id" AND p."status"::text = 'paid' AND p."user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'registrations: the payment must be paid and belong to the same user';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER registrations_payment_paid
  BEFORE INSERT OR UPDATE OF "payment_id", "user_id" ON "registrations"
  FOR EACH ROW EXECUTE FUNCTION registrations_payment_paid();

-- ───────────── registration attempts and phones ─────────────
-- One stored phone form, so uniqueness is real: 017..., +88017... and 88017... are normalised to 01XXXXXXXXX by the
-- server before they get here (DECISIONS "Duplicate email and phone at registration", owner). NULL stays allowed on
-- users (e.g. admins made by the CLI); the UNIQUE index from M1 ignores NULLs.
ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^01[3-9][0-9]{8}$');

ALTER TABLE "pending_registrations"
  ADD CONSTRAINT "pending_registrations_phone_check" CHECK ("phone" ~ '^01[3-9][0-9]{8}$'),
  ADD CONSTRAINT "pending_registrations_completed_check" CHECK (
    ("status"::text = 'completed') = ("user_id" IS NOT NULL AND "completed_at" IS NOT NULL)
  );

-- At most one attempt in progress per email and per phone: the paths to a double charge stay closed.
CREATE UNIQUE INDEX "pending_registrations_one_open_per_email" ON "pending_registrations" ("email")
  WHERE "status" = 'open';
CREATE UNIQUE INDEX "pending_registrations_one_open_per_phone" ON "pending_registrations" ("phone")
  WHERE "status" = 'open';

-- ───────────── payment_events: append-only ─────────────
ALTER TABLE "payment_events"
  ADD CONSTRAINT "payment_events_source_check" CHECK (
    "source" IN ('initiate', 'callback', 'ipn', 'status_v1', 'admin')
  ),
  ADD CONSTRAINT "payment_events_outcome_check" CHECK ("outcome" ~ '^[a-z0-9_]{1,40}$'),
  ADD CONSTRAINT "payment_events_payload_size_check" CHECK (
    "payload" IS NULL OR octet_length("payload"::text) <= 16384
  );

-- Same rule as audit_logs: rows are inserted and read, never changed or removed. Tests do not truncate this table
-- (test/helpers.ts truncateAll); they tell their rows apart by ids.
CREATE FUNCTION payment_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER payment_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION payment_events_append_only();

CREATE TRIGGER payment_events_no_truncate
  BEFORE TRUNCATE ON "payment_events"
  FOR EACH STATEMENT EXECUTE FUNCTION payment_events_append_only();

-- ───────────── settings ─────────────
-- The fee is a positive whole-taka amount in paisa (DECISIONS "Registration fee"). Runs after M2, which replaced the
-- placeholder 0. The admin endpoint adds the 10-10,000 BDT bounds. CASE fixes the evaluation order: SQL does not
-- promise AND short-circuits, and casting a JSON string or boolean to numeric would raise instead of failing here.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_registration_fee_check" CHECK (
    "key" <> 'registration_fee_minor'
    OR CASE
      WHEN jsonb_typeof("value") = 'number'
        THEN ("value")::numeric > 0 AND ("value")::numeric % 100 = 0
      ELSE false
    END
  );
