-- App-wide session timeouts (A2.1). Database-level defaults apply to every NEW session: the API (through PgBouncer),
-- workers, migrations and psql. pg_dump, and the dumps it writes, set all three to 0 for themselves.
--   statement_timeout 10s: no statement outlives the API's 25 s request timeout (nginx gives up at 30 s).
--   lock_timeout 5s: a statement waiting for a lock fails fast instead of piling up behind it. A migration that
--     waits for an exclusive lock behind a long transaction also fails, instead of stalling traffic behind it.
--   idle_in_transaction_session_timeout 60s: a transaction left open by a crashed or stuck client cannot hold row
--     locks or a PgBouncer server connection for ever.
-- A migration or job that needs longer sets its own value first, e.g. `SET statement_timeout = '15min';`.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '10s');
  EXECUTE format('ALTER DATABASE %I SET lock_timeout = %L', current_database(), '5s');
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '60s');
END
$$;
