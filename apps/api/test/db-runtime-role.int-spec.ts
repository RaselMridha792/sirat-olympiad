/**
 * The runtime role sirat_app (OPEN-QUESTIONS #27, LAUNCH-PLAN L2): its attributes, its rights on the database, the
 * schema and every table, the default privileges for what a later migration adds, what prisma/runtime-role.ts
 * re-asserts (the restrictions, the role's own settings, the database timeouts) and the SCRAM verifier it writes.
 * Checks that change something run in a transaction that is rolled back. The denial checks connect as sirat_app and run
 * when TEST_APP_DATABASE_URL is set (CI always sets it; locally see RUNBOOK §0).
 */
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  QUIET_SESSION,
  applyDatabaseTimeouts,
  assertRestrictions,
  clearRoleSettings,
  quietUrl,
  scramVerifier,
} from '../prisma/runtime-role';
import { PrismaService, describeDatabaseRole } from '../src/prisma/prisma.service';
import { testPrisma } from './helpers';

const owner = testPrisma();
const appUrl = process.env.TEST_APP_DATABASE_URL ?? '';
const DATA = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
const NEVER = ['TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;
/** The append-only tables today. The catalog test also checks any later one, found by its trigger. */
/** The demo registry (DECISIONS 2026-11-08): written by the loader, removed only by demo_clear as the owner. */
const DEMO_REGISTRY: Record<string, readonly string[]> = {
  demo_records: ['SELECT', 'INSERT'],
  demo_batches: ['SELECT', 'INSERT', 'UPDATE'],
};
const APPEND_ONLY = [
  'answer_key_corrections',
  'audit_logs',
  'payment_events',
  'point_ledger',
  'submissions',
];

afterAll(async () => {
  await owner.$disconnect();
});

/** Runs `work` in a transaction on `client` that is always rolled back, and returns what `work` returned. */
async function rolledBack<T>(
  client: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const rollback = new Error('rollback');
  let result: T | undefined;
  await client
    .$transaction(async (tx) => {
      result = await work(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
  return result as T;
}

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

async function testDatabase(): Promise<string> {
  const [row] = await owner.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = row?.db ?? '';
  expect(db).toMatch(/^[a-z0-9_]+_test$/); // also makes it safe to quote as an identifier below
  return db;
}

/** The settings stored for the connected database (ALTER DATABASE ... SET), as the caller's transaction sees them. */
async function databaseSettings(tx: Prisma.TransactionClient): Promise<Record<string, string>> {
  const rows = await tx.$queryRaw<{ name: string; value: string }[]>`
    SELECT split_part(c.setting, '=', 1) AS name, split_part(c.setting, '=', 2) AS value
    FROM pg_db_role_setting s, unnest(s.setconfig) AS c(setting)
    WHERE s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

describe('the runtime role sirat_app', () => {
  it('exists, without superuser, createdb, createrole, replication or bypassrls', async () => {
    const rows = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'sirat_app'`;
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0] ?? {})).toEqual([false, false, false, false, false]);
  });

  it('may connect and use the schema, but create nothing: no temporary table, schema or table', async () => {
    const [row] = await owner.$queryRaw<Record<string, boolean>[]>`
      SELECT has_database_privilege('sirat_app', current_database(), 'CONNECT') AS "connect",
             has_database_privilege('sirat_app', current_database(), 'TEMPORARY') AS "temporary",
             has_database_privilege('public', current_database(), 'TEMPORARY') AS "publicTemporary",
             has_database_privilege('sirat_app', current_database(), 'CREATE') AS "createSchema",
             has_schema_privilege('sirat_app', 'public', 'USAGE') AS "usage",
             has_schema_privilege('sirat_app', 'public', 'CREATE') AS "createTable"`;
    expect(row).toEqual({
      connect: true,
      temporary: false,
      publicTemporary: false,
      createSchema: false,
      usage: true,
      createTable: false,
    });
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
          WHERE NOT t.tgisinternal AND p.proname LIKE '%\\_append\\_only'`
      ).map((r) => r.name),
    );
    expect([...appendOnly]).toEqual(expect.arrayContaining(APPEND_ONLY));
    const wrong: string[] = [];
    for (const { name } of tables) {
      const expected: readonly string[] =
        name === '_prisma_migrations'
          ? []
          : appendOnly.has(name)
            ? ['SELECT', 'INSERT']
            : (DEMO_REGISTRY[name] ?? DATA);
      for (const privilege of [...DATA, ...NEVER]) {
        const [row] = await owner.$queryRaw<{ ok: boolean }[]>`
          SELECT has_table_privilege('sirat_app', ${`public."${name}"`}, ${privilege}) AS ok`;
        if (Boolean(row?.ok) !== expected.includes(privilege)) wrong.push(`${name} ${privilege}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('gets the same data rights on every table or sequence the owner creates later (default privileges)', async () => {
    const defaults = await owner.$queryRaw<{ type: string; privilege: string }[]>`
      SELECT d.defaclobjtype::text AS type, a.privilege_type AS privilege
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'sirat_app')
      ORDER BY d.defaclobjtype::text COLLATE "C", a.privilege_type COLLATE "C"`;
    expect(defaults).toEqual([
      { type: 'S', privilege: 'SELECT' },
      { type: 'S', privilege: 'USAGE' },
      { type: 'r', privilege: 'DELETE' },
      { type: 'r', privilege: 'INSERT' },
      { type: 'r', privilege: 'SELECT' },
      { type: 'r', privilege: 'UPDATE' },
    ]);
    const granted = await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe('CREATE TABLE runtime_role_probe (id int)');
      await tx.$executeRawUnsafe('CREATE SEQUENCE runtime_role_probe_seq');
      const seen: string[] = [];
      for (const privilege of [...DATA, ...NEVER]) {
        const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT has_table_privilege('sirat_app', 'runtime_role_probe', ${privilege}) AS ok`;
        if (row?.ok) seen.push(privilege);
      }
      for (const privilege of ['USAGE', 'SELECT', 'UPDATE']) {
        const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT has_sequence_privilege('sirat_app', 'runtime_role_probe_seq', ${privilege}) AS ok`;
        if (row?.ok) seen.push(`sequence ${privilege}`);
      }
      return seen;
    });
    expect(granted).toEqual([...DATA, 'sequence USAGE', 'sequence SELECT']);
  });

  it('runtime-role.ts puts back the database timeouts a restore lost, and keeps one a migration changed', async () => {
    const db = await testDatabase();
    const result = await rolledBack(owner, async (tx) => {
      for (const name of [
        'statement_timeout',
        'lock_timeout',
        'idle_in_transaction_session_timeout',
      ]) {
        await tx.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET ${name}`);
      }
      const setAfterLoss = await applyDatabaseTimeouts(tx);
      const afterLoss = await databaseSettings(tx);
      await tx.$executeRawUnsafe(`ALTER DATABASE "${db}" SET statement_timeout = '15s'`);
      const setAfterChange = await applyDatabaseTimeouts(tx);
      const afterChange = await databaseSettings(tx);
      return { setAfterLoss, afterLoss, setAfterChange, afterChange };
    });
    expect(result.setAfterLoss).toBe(3);
    expect(result.afterLoss).toMatchObject({
      statement_timeout: '10s',
      lock_timeout: '5s',
      idle_in_transaction_session_timeout: '60s',
    });
    expect(result.setAfterChange).toBe(0);
    expect(result.afterChange).toMatchObject({ statement_timeout: '15s' });
  });

  it('runtime-role.ts takes back what a restore can give back: temporary tables, the append-only rows, the migration log', async () => {
    const db = await testDatabase();
    const after = await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe(`GRANT TEMPORARY ON DATABASE "${db}" TO PUBLIC`);
      await tx.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${db}" FROM sirat_app`);
      const list = APPEND_ONLY.map((t) => `"${t}"`).join(', ');
      await tx.$executeRawUnsafe(`GRANT UPDATE, DELETE ON TABLE ${list} TO sirat_app`);
      await tx.$executeRawUnsafe('GRANT ALL ON TABLE "_prisma_migrations" TO sirat_app');
      await assertRestrictions(tx);
      const [row] = await tx.$queryRaw<
        { publicTemporary: boolean; connect: boolean; migrationLog: boolean }[]
      >`
        SELECT has_database_privilege('public', current_database(), 'TEMPORARY') AS "publicTemporary",
               EXISTS (SELECT 1 FROM pg_database d, aclexplode(d.datacl) a
                       WHERE d.datname = current_database() AND a.privilege_type = 'CONNECT'
                         AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'sirat_app')) AS "connect",
               has_table_privilege('sirat_app', 'public."_prisma_migrations"', 'SELECT') AS "migrationLog"`;
      const changeable: string[] = [];
      for (const table of APPEND_ONLY) {
        for (const privilege of ['UPDATE', 'DELETE']) {
          const [r] = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT has_table_privilege('sirat_app', ${`public."${table}"`}, ${privilege}) AS ok`;
          if (r?.ok) changeable.push(`${table} ${privilege}`);
        }
      }
      return { ...row, changeable };
    });
    expect(after).toEqual({
      publicTemporary: false,
      connect: true,
      migrationLog: false,
      changeable: [],
    });
  });

  it('runtime-role.ts clears the session settings sirat_app gave itself (every role may set its own)', async () => {
    const db = await testDatabase();
    const after = await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe('ALTER ROLE sirat_app SET statement_timeout = 0');
      await tx.$executeRawUnsafe(
        `ALTER ROLE sirat_app IN DATABASE "${db}" SET default_transaction_read_only = on`,
      );
      const cleared = await clearRoleSettings(tx);
      const [row] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
        WHERE r.rolname = 'sirat_app'
          AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`;
      return { cleared, left: row?.n };
    });
    expect(after.cleared).toBeGreaterThanOrEqual(2);
    expect(after.left).toBe(0);
  });

  it('writes a SCRAM verifier that PostgreSQL accepts for the right password only (a scratch role, dropped after)', async () => {
    // One name per test database (sessions share a cluster, roles are cluster-wide): a run that died leaves its role
    // behind, the next run in the same database removes it, and a leftover expires within minutes anyway.
    const name = `sirat_scram_probe_${await testDatabase()}`;
    const password = randomBytes(24).toString('hex');
    const validUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${name}`);
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${name} LOGIN PASSWORD '${scramVerifier(password)}' VALID UNTIL '${validUntil}'`,
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

  it('runs the script on a connection that keeps statement text out of the server log (QUIET_SESSION)', async () => {
    const quiet = new PrismaClient({
      datasourceUrl: quietUrl(process.env.TEST_DATABASE_URL ?? ''),
    });
    try {
      const names = Object.keys(QUIET_SESSION);
      const [row] = await quiet.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT ${names.map((n) => `current_setting('${n}') AS "${n}"`).join(', ')}`,
      );
      expect(row).toEqual(QUIET_SESSION);
    } finally {
      await quiet.$disconnect();
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

  it('is what the app under test connects as (PrismaService reads the DATABASE_URL load-env.ts set)', async () => {
    const service = new PrismaService();
    try {
      expect(await describeDatabaseRole(service)).toEqual({ name: 'sirat_app', superuser: false });
    } finally {
      await service.$disconnect();
    }
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
    ['create a temporary table that hides a real one', 'CREATE TEMP TABLE exams (id uuid)'],
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
    ['remove a point ledger row', 'DELETE FROM point_ledger WHERE false'],
    ['remove a submission', 'DELETE FROM submissions WHERE false'],
  ])('may not %s', async (_what, statement) => {
    // Inside a transaction that is rolled back, so a statement that wrongly succeeds changes nothing.
    expect(await sqlState(() => rolledBack(app, (tx) => tx.$executeRawUnsafe(statement)))).toBe(
      '42501',
    );
  });
});
