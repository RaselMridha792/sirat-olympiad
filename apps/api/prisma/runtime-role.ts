/**
 * The runtime role's login (OPEN-QUESTIONS #27, LAUNCH-PLAN L2). The migrate job runs it after `prisma migrate deploy`
 * (apps/api/Dockerfile), connected as the bootstrap superuser through DIRECT_URL. The migration
 * 20261031224147_runtime_role creates `sirat_app` (NOLOGIN) and its grants; this script:
 *  - manages only the fixed role `sirat_app`, never the role in DIRECT_URL and never a name from input;
 *  - sets its LOGIN and password from POSTGRES_APP_PASSWORD with a SCRAM-SHA-256 verifier computed here, so the
 *    plaintext never reaches Postgres or its log;
 *  - re-applies the database's statement, lock and idle timeouts, because a restore into a fresh database loses them
 *    while the migration that set them stays recorded as applied;
 *  - with `--ensure`, only makes sure the role exists (NOLOGIN), for a restore before pg_restore (LAUNCH-PLAN L7).
 * It prints one line and never a value.
 *
 * On a cluster marked `sirat.environment=development` (the shared dev stack, used by every worktree) the password is
 * set only while the role has none, so one worktree's value can never reset another's. Until L8 switches the API to the
 * role, an empty POSTGRES_APP_PASSWORD only skips the password step.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export const RUNTIME_ROLE = 'sirat_app';

/** The same values as migration 20261030165953_db_session_timeouts (A2.1). */
export const DATABASE_TIMEOUTS = [
  ['statement_timeout', '10s'],
  ['lock_timeout', '5s'],
  ['idle_in_transaction_session_timeout', '60s'],
] as const;

/** URL-safe (it is also part of DATABASE_URL), long enough, and never a placeholder. `openssl rand -hex 32` fits. */
const PASSWORD_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;
const PLACEHOLDER = /(fake|change.?me|example|placeholder|dummy|sample|password|xxxx)/i;

/** What to say about POSTGRES_APP_PASSWORD, or null when it is usable. Names the rule, never the value. */
export function passwordProblem(password: string): string | null {
  if (!PASSWORD_SHAPE.test(password)) {
    return 'POSTGRES_APP_PASSWORD must be 32-128 letters, digits, "-" or "_" (e.g. openssl rand -hex 32)';
  }
  if (PLACEHOLDER.test(password)) return 'POSTGRES_APP_PASSWORD looks like a placeholder';
  return null;
}

export type PasswordStep = 'skip-empty' | 'keep-dev' | 'set';

/** Whether to set the password now. The development cluster keeps the first value it was given. */
export function passwordStep(input: { password: string; development: boolean; hasPassword: boolean }): PasswordStep {
  if (!input.password) return 'skip-empty';
  if (input.development && input.hasPassword) return 'keep-dev';
  return 'set';
}

/**
 * A SCRAM-SHA-256 verifier in PostgreSQL's stored format (RFC 5802/7677). PostgreSQL stores a password given in this
 * form as it is, so the plaintext never travels to the server. The password must be ASCII (SASLprep is then a no-op).
 */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const VERIFIER_SHAPE = /^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/** Creates the role if it is missing (NOLOGIN, no password); safe to repeat. */
export async function ensureRole(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
        CREATE ROLE ${RUNTIME_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN NULL;
    END
    $$`);
}

/** Puts the database-level timeouts back on the connected database. */
export async function applyDatabaseTimeouts(db: PrismaClient): Promise<void> {
  for (const [name, value] of DATABASE_TIMEOUTS) {
    // Fixed names and values; only the database name comes from the server, quoted by format(%I).
    await db.$executeRawUnsafe(`
      DO $$
      BEGIN
        EXECUTE format('ALTER DATABASE %I SET ${name} = %L', current_database(), '${value}');
      END
      $$`);
  }
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('runtime role: DIRECT_URL is not set');
    return 2;
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await ensureRole(db);
    if (process.argv.includes('--ensure')) {
      console.log(`runtime role exists: ${RUNTIME_ROLE}`);
      return 0;
    }
    await applyDatabaseTimeouts(db);

    const password = process.env.POSTGRES_APP_PASSWORD ?? '';
    if (password) {
      const problem = passwordProblem(password);
      if (problem) {
        console.error(`runtime role: ${problem}`);
        return 2;
      }
    }
    const [state] = await db.$queryRaw<{ development: boolean; hasPassword: boolean }[]>`
      SELECT coalesce(current_setting('sirat.environment', true), '') = 'development' AS "development",
             (SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname = ${RUNTIME_ROLE}) AS "hasPassword"`;
    const step = passwordStep({
      password,
      development: state?.development ?? false,
      hasPassword: state?.hasPassword ?? false,
    });
    if (step === 'skip-empty') {
      console.log(`runtime role ready: ${RUNTIME_ROLE} (no login yet: POSTGRES_APP_PASSWORD is empty)`);
      return 0;
    }
    if (step === 'keep-dev') {
      console.log(`runtime role ready: ${RUNTIME_ROLE} (development cluster: password already set, kept)`);
      return 0;
    }
    const verifier = scramVerifier(password);
    if (!VERIFIER_SHAPE.test(verifier)) throw new Error('unexpected verifier shape');
    // The verifier holds only base64 characters, digits, "$" and ":", so it cannot leave the string literal.
    await db.$executeRawUnsafe(`ALTER ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD '${verifier}'`);
    console.log(`runtime role ready: ${RUNTIME_ROLE} (login and password set)`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      // The error class and Postgres code only: never a statement that could hold a verifier.
      const e = error as { name?: string; code?: string; meta?: { code?: string } };
      console.error(`runtime role: failed (${e.name ?? 'Error'} ${e.meta?.code ?? e.code ?? ''})`);
      process.exit(1);
    },
  );
}
