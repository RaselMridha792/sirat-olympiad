/**
 * Safety guard for DEV/TEST-ONLY fixtures (owner decision 2026-10-30: fixtures must never run in production).
 * Every check must pass; any failure throws before a single row is written.
 * A further layer lives outside this file: `apps/api/prisma/fixtures` is excluded from every Docker image
 * (.dockerignore), so production images do not even contain the fixture code.
 */
export const FIXTURE_CONFIRM_VALUE = 'yes-this-is-not-production';
const ALLOWED_NODE_ENVS = new Set(['development', 'test']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertFixturesAllowed(env: Readonly<Record<string, string | undefined>>): void {
  const nodeEnv = env.NODE_ENV ?? '';
  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`Refusing to load fixtures: NODE_ENV must be development or test (got "${nodeEnv || 'unset'}").`);
  }
  if (env.ALLOW_DEV_FIXTURES !== FIXTURE_CONFIRM_VALUE) {
    throw new Error(`Refusing to load fixtures: set ALLOW_DEV_FIXTURES=${FIXTURE_CONFIRM_VALUE}.`);
  }
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Refusing to load fixtures: DATABASE_URL is not set.');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('Refusing to load fixtures: DATABASE_URL is not a valid URL.');
  }
  // Production and the compose network use service hostnames (pgbouncer, postgres); only a local DB is allowed.
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to load fixtures: database host "${host}" is not local.`);
  }
}
