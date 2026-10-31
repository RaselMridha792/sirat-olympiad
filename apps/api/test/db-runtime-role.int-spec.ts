/**
 * The runtime role sirat_app (OPEN-QUESTIONS #27, LAUNCH-PLAN L2): its attributes, its grants on every table, the
 * default privileges for tables a later migration adds, the database timeouts that prisma/runtime-role.ts puts back,
 * and the SCRAM verifier it writes. The denial checks connect as sirat_app and run when TEST_APP_DATABASE_URL is set
 * (CI always sets it; locally see RUNBOOK §0).
 */
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { applyDatabaseTimeouts, scramVerifier } from '../prisma/runtime-role';
import { describeDatabaseRole } from '../src/prisma/prisma.service';
import { testPrisma } from './helpers';

const owner = testPrisma();
const appUrl = process.env.TEST_APP_DATABASE_URL ?? '';
const DATA = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
const NEVER = ['TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

afterAll(async () => {
  await owner.$disconnect();
});

/** The Postgres code of a failed raw statement (Prisma puts it in meta.code), or a description of what happened. */
async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'succeeded';
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return String((error.meta as { code?: string } | undefined)?.code ?? error.code);
    }
    return error instanceof Error ? error.name : 'unknown error';
  }
}

describe('the runtime role sirat_app', () => {
  it('exists, without superuser, createdb, createrole, replication or bypassrls', async () => {
    const rows = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'sirat_app'`;
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0] ?? {})).toEqual([false, false, false, false, false]);
  });

  it('may read and write every table, only read and insert the append-only ones, and nothing else', async () => {
    const tables = await owner.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`;
    // The append-only set comes from the triggers, so a new append-only table is checked without editing this test.
    const appendOnly = new Set(
      (
        await owner.$queryRaw<{ name: string }[]>`
          SELECT DISTINCT c.relname AS name FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE NOT t.tgisinternal AND p.proname LIKE '%\_append\_only'`
      ).map((r) => r.name),
    );
    expect([...appendOnly].sort()).toEqual(['audit_logs', 'payment_events', 'submissions']);
    const wrong: string[] = [];
    for (const { name } of tables) {
      const expected: readonly string[] =
        name === '_prisma_migrations' ? [] : appendOnly.has(name) ? ['SELECT', 'INSERT'] : DATA;
      for (const privilege of [...DATA, ...NEVER]) {
        const [row] = await owner.$queryRaw<{ ok: boolean }[]>`
          SELECT has_table_privilege('sirat_app', ${`public."${name}"`}, ${privilege}) AS ok`;
        if (Boolean(row?.ok) !== expected.includes(privilege)) wrong.push(`${name} ${privilege}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('gets the same data rights on a table the owner creates later (default privileges)', async () => {
    const rollback = new Error('rollback');
    let seen: { insert: boolean; truncate: boolean } | undefined;
    await owner
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE TABLE runtime_role_probe (id int)');
        const [row] = await tx.$queryRaw<{ insert: boolean; truncate: boolean }[]>`
          SELECT has_table_privilege('sirat_app', 'runtime_role_probe', 'INSERT') AS "insert",
                 has_table_privilege('sirat_app', 'runtime_role_probe', 'TRUNCATE') AS "truncate"`;
        seen = row;
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    expect(seen).toEqual({ insert: true, truncate: false });
  });

  it('runtime-role.ts puts the database timeouts back after a restore lost them', async () => {
    const [{ db } = { db: '' }] = await owner.$queryRaw<
      { db: string }[]
    >`SELECT current_database() AS db`;
    expect(db).toMatch(/_test$/);
    await owner.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET statement_timeout`);
    await owner.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET lock_timeout`);
    await applyDatabaseTimeouts(owner);
    const fresh = testPrisma(); // a new session reads the database defaults
    try {
      const [row] = await fresh.$queryRaw<{ statement: string; lock: string; idle: string }[]>`
        SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock,
               current_setting('idle_in_transaction_session_timeout') AS idle`;
      expect(row).toEqual({ statement: '10s', lock: '5s', idle: '1min' });
    } finally {
      await fresh.$disconnect();
    }
  });

  it('writes a SCRAM verifier that PostgreSQL accepts for the right password only (a scratch role, dropped after)', async () => {
    const name = `sirat_scram_probe_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(24).toString('hex');
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${name} LOGIN PASSWORD '${scramVerifier(password)}'`,
    );
    try {
      const url = new URL(process.env.TEST_DATABASE_URL ?? '');
      url.username = name;
      url.password = password;
      const probe = new PrismaClient({ datasourceUrl: url.toString() });
      try {
        expect(await describeDatabaseRole(probe)).toEqual({ name, superuser: false });
      } finally {
        await probe.$disconnect();
      }
      url.password = `${password}x`;
      const wrong = new PrismaClient({ datasourceUrl: url.toString() });
      try {
        await expect(wrong.$queryRaw`SELECT 1`).rejects.toThrow();
      } finally {
        await wrong.$disconnect();
      }
    } finally {
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${name}`);
    }
  });

  it('describes the owner connection as a superuser (the boot line warns about it in production)', async () => {
    expect((await describeDatabaseRole(owner)).superuser).toBe(true);
  });
});

(appUrl ? describe : describe.skip)('connected as sirat_app', () => {
  const app = new PrismaClient({
    datasourceUrl: appUrl || 'postgresql://unused@127.0.0.1/unused_test',
  });
  afterAll(async () => {
    await app.$disconnect();
  });

  it('is not a superuser, and sees the 10s/5s/1min database timeouts', async () => {
    expect(await describeDatabaseRole(app)).toEqual({ name: 'sirat_app', superuser: false });
    const [row] = await app.$queryRaw<{ statement: string; lock: string; idle: string }[]>`
      SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock,
             current_setting('idle_in_transaction_session_timeout') AS idle`;
    expect(row).toEqual({ statement: '10s', lock: '5s', idle: '1min' });
  });

  it.each([
    ['truncate a table', 'TRUNCATE TABLE sessions'],
    ['switch off the append-only trigger', 'ALTER TABLE audit_logs DISABLE TRIGGER ALL'],
    ['skip every trigger', "SET session_replication_role = 'replica'"],
    ['create a table', 'CREATE TABLE runtime_role_intruder (id int)'],
    ['drop a table', 'DROP TABLE announcements'],
    [
      'change the database settings',
      "DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET statement_timeout = 0', current_database()); END $$",
    ],
    ['run a shell command', "COPY (SELECT 1) TO PROGRAM 'true'"],
    ['read the migration log', 'SELECT * FROM "_prisma_migrations"'],
    ['change an audit row', "UPDATE audit_logs SET action = 'x' WHERE false"],
    ['remove an audit row', 'DELETE FROM audit_logs WHERE false'],
    ['remove a payment event', 'DELETE FROM payment_events WHERE false'],
  ])('may not %s', async (_what, statement) => {
    expect(await sqlState(() => app.$executeRawUnsafe(statement))).toBe('42501');
  });
});
