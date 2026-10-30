/**
 * Safety guard for DEV/TEST-ONLY fixtures (owner decision 2026-10-30: fixtures must never run in production).
 * Every check must pass; any failure throws before a single row is written. Layers:
 * 1. assertFixturesAllowed (before connecting): NODE_ENV is development/test, the per-run confirmation is set,
 *    the URL host is local and the URL carries no host/hostaddr override (Prisma lets ?host= replace the host).
 * 2. assertDevServerMarker (after connecting, before any other query): the database SERVER itself must carry
 *    `sirat.environment=development|test`, which only infra/docker-compose.dev.yml sets. A production server reached
 *    over an SSH tunnel or a mistaken loopback URL has no marker and is refused.
 * 3. `apps/api/prisma/fixtures` is excluded from every Docker image (.dockerignore), so images do not contain this code.
 * The marker prevents accidents; it is not a security boundary (any session could SET it), so app code never sets it.
 */
export const FIXTURE_CONFIRM_VALUE = 'yes-this-is-not-production';
export const DEV_SERVER_MARKERS = new Set(['development', 'test']);
const ALLOWED_NODE_ENVS = new Set(['development', 'test']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const HOST_OVERRIDE_KEYS = new Set(['host', 'hostaddr']);

export function assertFixturesAllowed(env: Readonly<Record<string, string | undefined>>): void {
  const nodeEnv = env.NODE_ENV ?? '';
  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`Refusing to load fixtures: NODE_ENV must be development or test (got "${nodeEnv || 'unset'}").`);
  }
  if (env.ALLOW_DEV_FIXTURES !== FIXTURE_CONFIRM_VALUE) {
    throw new Error(`Refusing to load fixtures: set ALLOW_DEV_FIXTURES=${FIXTURE_CONFIRM_VALUE} for this run.`);
  }
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Refusing to load fixtures: DATABASE_URL is not set.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to load fixtures: DATABASE_URL is not a valid URL.');
  }
  // Refuse the key itself whatever its value or case: Prisma lets ?host= override the URL authority.
  const keys = [...parsed.searchParams.keys()].map((k) => k.toLowerCase());
  if (keys.some((k) => HOST_OVERRIDE_KEYS.has(k))) {
    throw new Error('Refusing to load fixtures: DATABASE_URL must not carry a host/hostaddr query parameter.');
  }
  // Production and the compose network use service hostnames (pgbouncer, postgres); only a local DB is allowed.
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to load fixtures: database host "${parsed.hostname}" is not local.`);
  }
}

/** `marker` is `current_setting('sirat.environment', true)` read through the same connection the fixtures use. */
export function assertDevServerMarker(marker: string | null | undefined): void {
  if (!marker || !DEV_SERVER_MARKERS.has(marker)) {
    throw new Error(
      `Refusing to load fixtures: the connected database server is not marked dev/test (sirat.environment=${marker || 'unset'}). ` +
        'Start Postgres with infra/docker-compose.dev.yml.',
    );
  }
}
