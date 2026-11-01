/**
 * The runtime role's login and restrictions (OPEN-QUESTIONS #27, LAUNCH-PLAN L2). The migrate job runs it after
 * `prisma migrate deploy` (apps/api/Dockerfile), connected as the bootstrap superuser through DIRECT_URL. The migration
 * 20261031224147_runtime_role creates `sirat_app` (NOLOGIN) and its grants; this script:
 *  - manages only the fixed role `sirat_app`, never the role in DIRECT_URL and never a name from input;
 *  - re-asserts the restrictions that a restore or a late-merged migration can undo (CONNECT for sirat_app, no
 *    temporary tables, nothing on `_prisma_migrations`, no UPDATE or DELETE on the append-only tables). It never adds
 *    other rights, so a later migration that narrows a table's grants stays in charge;
 *  - clears every role-level setting of sirat_app (PostgreSQL lets every role set its own, and no grant stops it);
 *  - puts back a database timeout only where it is missing: a restore into a fresh database loses them, while the
 *    migration that set them stays recorded as applied. A later migration that changes one stays in charge;
 *  - sets its LOGIN and password from POSTGRES_APP_PASSWORD with a SCRAM-SHA-256 verifier computed here, so the
 *    plaintext never reaches Postgres. Its connection keeps statement text out of the server log (QUIET_SESSION);
 *  - with `--ensure`, only makes sure the role exists (NOLOGIN), for a restore before pg_restore (LAUNCH-PLAN L7).
 * One run at a time per database (an advisory lock), all steps in one transaction. It prints one line and never a
 * value, plus a warning line when it cleared settings.
 *
 * On a cluster marked `sirat.environment=development` (the shared dev stack, used by every worktree) the password is
 * set only while the role has none, so one worktree's value can never reset another's. Until L8 switches the API to the
 * role, an empty POSTGRES_APP_PASSWORD only skips the password step.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
// Types only: main() loads Prisma Client after it has checked DIRECT_URL (see there).
import type { Prisma } from '@prisma/client';

export const RUNTIME_ROLE = 'sirat_app';

/** The attributes of the migration's CREATE ROLE (runtime-role.spec.ts keeps the two the same). */
export const ROLE_ATTRIBUTES =
  'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

/** The same values as migration 20261030165953_db_session_timeouts (A2.1). */
export const DATABASE_TIMEOUTS = [
  ['statement_timeout', '10s'],
  ['lock_timeout', '5s'],
  ['idle_in_transaction_session_timeout', '60s'],
] as const;

/**
 * Settings for the script's own connection, set at connection start (the URL's `options`): no statement text in the
 * server log whatever postgresql.conf or ALTER DATABASE says, because the ALTER ROLE carries the verifier. At start,
 * not with SET LOCAL, because transaction sampling is decided at BEGIN. Superuser-only settings among them: the migrate
 * job connects as the bootstrap superuser.
 */
export const QUIET_SESSION = {
  log_statement: 'none',
  log_min_duration_statement: '-1',
  log_min_error_statement: 'panic',
  log_min_messages: 'warning',
  log_min_duration_sample: '-1',
  log_transaction_sample_rate: '0',
  debug_print_parse: 'off',
  debug_print_rewritten: 'off',
} as const;

/** DIRECT_URL with QUIET_SESSION as its connection options. */
export function quietUrl(url: string): string {
  const quiet = new URL(url);
  const options = Object.entries(QUIET_SESSION).map(([name, value]) => `-c ${name}=${value}`);
  quiet.searchParams.set('options', options.join(' '));
  return quiet.toString();
}

/** One run at a time per database: two at once would otherwise both rewrite the same catalog rows (XX000). */
const ADVISORY_LOCK = 72_707_370; // any fixed key; Prisma's migrate lock is 72707369

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
export function passwordStep(input: {
  password: string;
  development: boolean;
  hasPassword: boolean;
}): PasswordStep {
  if (!input.password) return 'skip-empty';
  if (input.development && input.hasPassword) return 'keep-dev';
  return 'set';
}

/** The one line the script prints; `hadLogin` is whether the role could log in before this run. */
export function readyLine(step: PasswordStep, hadLogin: boolean): string {
  const prefix = `runtime role ready: ${RUNTIME_ROLE}`;
  if (step === 'set') return `${prefix} (login and password set)`;
  if (step === 'keep-dev') return `${prefix} (development cluster: password already set, kept)`;
  return hadLogin
    ? `${prefix} (POSTGRES_APP_PASSWORD is empty: the existing login is kept)`
    : `${prefix} (no login yet: POSTGRES_APP_PASSWORD is empty)`;
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

/** A client or an interactive transaction: the tests run these steps inside a transaction they roll back. */
type Db = Prisma.TransactionClient;

/** Creates the role if it is missing (NOLOGIN, no password); safe to repeat. */
export async function ensureRole(db: Db): Promise<void> {
  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
        CREATE ROLE ${RUNTIME_ROLE} ${ROLE_ATTRIBUTES};
      END IF;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN NULL;
    END
    $$`);
}

/**
 * Re-asserts the migration's restrictions on the connected database, where each can be lost:
 *  - a dump made without --create carries no database-level grants, so a restore into a fresh database gives PUBLIC
 *    its TEMPORARY back and drops sirat_app's CONNECT;
 *  - `pg_restore --clean` over a live schema re-creates each table under the default privileges, so sirat_app gets
 *    UPDATE and DELETE on the append-only tables and every right on `_prisma_migrations`;
 *  - a migration merged later but named earlier runs after the runtime-role migration on an existing database.
 */
export async function assertRestrictions(db: Db): Promise<void> {
  await db.$executeRawUnsafe(`
    DO $$
    DECLARE
      t record;
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${RUNTIME_ROLE}', current_database());
      EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
      IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
        REVOKE ALL ON TABLE "_prisma_migrations" FROM ${RUNTIME_ROLE};
      END IF;
      FOR t IN
        SELECT DISTINCT c.relname FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND p.proname LIKE '%\\_append\\_only'
      LOOP
        EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM ${RUNTIME_ROLE}', t.relname);
      END LOOP;
    END
    $$`);
}

/**
 * Clears the session defaults sirat_app gave itself, for all databases and for this one. Every PostgreSQL role may set
 * its own (`ALTER ROLE sirat_app SET statement_timeout = 0`, or `default_transaction_read_only = on`), and a role-level
 * value beats the database's. The app never sets any, so each one found is counted (never shown) and removed.
 */
export async function clearRoleSettings(db: Db): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT coalesce(sum(cardinality(s.setconfig)), 0)::int AS n
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
    WHERE r.rolname = ${RUNTIME_ROLE}
      AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`;
  const count = row?.n ?? 0;
  if (count === 0) return 0;
  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER ROLE ${RUNTIME_ROLE} RESET ALL;
      EXECUTE format('ALTER ROLE ${RUNTIME_ROLE} IN DATABASE %I RESET ALL', current_database());
    END
    $$`);
  return count;
}

/** Puts back each database-level timeout that is missing on the connected database; returns how many it set. */
export async function applyDatabaseTimeouts(db: Db): Promise<number> {
  let applied = 0;
  for (const [name, value] of DATABASE_TIMEOUTS) {
    const [row] = await db.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) AS c(setting)
        WHERE s.setrole = 0
          AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND split_part(c.setting, '=', 1) = ${name}
      ) AS present`;
    if (row?.present) continue;
    // Fixed names and values; only the database name comes from the server, quoted by format(%I).
    await db.$executeRawUnsafe(`
      DO $$
      BEGIN
        EXECUTE format('ALTER DATABASE %I SET ${name} = %L', current_database(), '${value}');
      END
      $$`);
    applied += 1;
  }
  return applied;
}

/**
 * Gives the role its login. A utility statement takes no parameters, so the verifier is in the statement text: it is
 * sent only on a connection whose settings keep statement text out of the server log (QUIET_SESSION).
 */
async function setLogin(db: Db, verifier: string): Promise<void> {
  if (!VERIFIER_SHAPE.test(verifier)) throw new Error('unexpected verifier shape');
  const quiet = Object.entries(QUIET_SESSION)
    .map(([name, value]) => `current_setting('${name}') = '${value}'`)
    .join(' AND ');
  const [row] = await db.$queryRawUnsafe<{ quiet: boolean }[]>(`SELECT ${quiet} AS quiet`);
  if (!row?.quiet) throw new Error('the connection may log statement text');
  // The verifier holds only base64 characters, digits, "$" and ":", so it cannot leave the string literal.
  await db.$executeRawUnsafe(`ALTER ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD '${verifier}'`);
}

async function main(): Promise<number> {
  // DIRECT_URL must come from this process's own environment (compose sets it for the migrate job). Prisma Client loads
  // a local .env when it is first loaded, and in a worktree that file names the dev database, so it is loaded only
  // after this check.
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('runtime role: DIRECT_URL is not set');
    return 2;
  }
  const ensureOnly = process.argv.includes('--ensure');
  const password = process.env.POSTGRES_APP_PASSWORD ?? '';
  const problem = password && !ensureOnly ? passwordProblem(password) : null;
  if (problem) {
    console.error(`runtime role: ${problem}`);
    return 2;
  }
  const { PrismaClient: Client } = await import('@prisma/client');
  const db = new Client({ datasourceUrl: quietUrl(url) });
  try {
    if (ensureOnly) {
      await ensureRole(db);
      console.log(`runtime role exists: ${RUNTIME_ROLE}`);
      return 0;
    }
    // All or nothing, and one run at a time per database. A second run waits for the lock (up to 30 s, not the
    // database's 5 s lock_timeout) and then finds nothing left to change.
    const outcome = await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '30s'`);
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`);
        await ensureRole(tx);
        await assertRestrictions(tx);
        const cleared = await clearRoleSettings(tx);
        await applyDatabaseTimeouts(tx);
        const [state] = await tx.$queryRaw<
          { development: boolean; hasPassword: boolean; canLogin: boolean }[]
        >`
          SELECT coalesce(current_setting('sirat.environment', true), '') = 'development' AS "development",
                 a.rolpassword IS NOT NULL AS "hasPassword", a.rolcanlogin AS "canLogin"
          FROM pg_authid a WHERE a.rolname = ${RUNTIME_ROLE}`;
        const hasPassword = state?.hasPassword ?? false;
        const development = state?.development ?? false;
        const step = passwordStep({ password, development, hasPassword });
        if (step === 'set') await setLogin(tx, scramVerifier(password));
        return { cleared, line: readyLine(step, hasPassword && (state?.canLogin ?? false)) };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    if (outcome.cleared > 0) {
      console.warn(
        `runtime role: cleared ${outcome.cleared} role-level setting(s) of ${RUNTIME_ROLE}`,
      );
    }
    console.log(outcome.line);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      // The error class and a code only: never a statement that could hold a verifier, never a URL. Prisma puts the
      // Postgres code in meta.code (raw queries) and its own code in code or, for a failed connection, errorCode.
      const e = error as {
        name?: string;
        code?: string;
        errorCode?: string;
        meta?: { code?: string };
      };
      const code = e.meta?.code ?? e.code ?? e.errorCode ?? '';
      console.error(`runtime role: failed (${e.name ?? 'Error'} ${code})`);
      process.exit(1);
    },
  );
}
