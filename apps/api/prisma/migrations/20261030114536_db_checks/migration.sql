-- DB-level CHECK constraints that Prisma cannot express (docs/05-DATABASE.md, RULEBOOK §6/§7.1).
-- Prisma ignores CHECK constraints when diffing, so later migrations will not drop these.
-- Names are explicit so integration tests can assert them.

-- Exam config: max 30 minutes, a real window, at least one question, non-negative grace.
ALTER TABLE "exams"
  ADD CONSTRAINT "exams_duration_minutes_check" CHECK ("duration_minutes" BETWEEN 1 AND 30),
  ADD CONSTRAINT "exams_window_check" CHECK ("window_end" > "window_start"),
  ADD CONSTRAINT "exams_questions_per_attempt_check" CHECK ("questions_per_attempt" > 0),
  ADD CONSTRAINT "exams_grace_seconds_check" CHECK ("grace_seconds" >= 0);

-- Money is a positive integer amount. A paid payment always carries the gateway trx id and paid time.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_minor_check" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payments_paid_has_trx_check" CHECK (
    "status" <> 'paid' OR ("trx_id" IS NOT NULL AND "paid_at" IS NOT NULL)
  );
