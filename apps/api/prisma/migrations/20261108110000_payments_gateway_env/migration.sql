-- Which PayStation environment a payment was started in ('sandbox', 'live', 'fake'), or 'demo' for demo data
-- (DECISIONS 2026-11-08 "Demo data"). The demo loader refuses a database that holds real money: a paid 'live' row.
-- Start always writes PAYSTATION_ENV. The default exists only for the backfill and is dropped right after, so a
-- write path that forgot the column fails loudly instead of making a live payment look like sandbox money.
-- Existing rows become 'sandbox': no payment has ever been started live (live needs NODE_ENV=production and the
-- client's account, and production has run only Rasel's sandbox so far).
ALTER TABLE "payments" ADD COLUMN "gateway_env" TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "payments" ALTER COLUMN "gateway_env" DROP DEFAULT;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_gateway_env_check" CHECK ("gateway_env" IN ('sandbox', 'live', 'fake', 'demo'));
