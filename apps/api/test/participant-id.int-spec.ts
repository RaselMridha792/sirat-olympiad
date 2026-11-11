/**
 * The participant ID (DECISIONS "The participant ID"; migration *_registrations_participant_id): the database draws it
 * for every registration (strong random, ON + 10 digits + a Damm check digit) and checks it; @sirat/shared mirrors the
 * rule (checked both ways here). Settlement's new account gets one; the result page shows it for 24 hours, the
 * dashboard always, and the confirmation email carries it; the audit never does. Existing registrations are backfilled.
 */
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  dammDigit,
  formatParticipantId,
  isParticipantId,
  PARTICIPANT_ID_SHOWN_HOURS,
} from '@sirat/shared';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { EmailQueue } from '../src/modules/notifications/email-queue.service';
import { makePaidPayment, makeUser, testInvoice, testPhone } from './helpers';
import { bootPaymentsApp, caller, startRegistration, type PaymentsApp } from './payments-app';

const PRISMA_DIR = join(__dirname, '..', 'prisma');
const MIGRATION_SUFFIX = '_registrations_participant_id';

let env: PaymentsApp;

beforeAll(async () => {
  env = await bootPaymentsApp();
}, 60_000);

afterAll(async () => {
  await env?.close();
});

afterEach(() => jest.restoreAllMocks());

/** A paid student with a registration, inserted the plain way (the column is never named: the DEFAULT draws it). */
async function registered(db: PrismaClient = env.prisma) {
  const user = await makeUser(db, { role: 'student' });
  const payment = await makePaidPayment(db, user.id);
  return db.registration.create({ data: { userId: user.id, paymentId: payment.id } });
}

const sqlCheck = async (id: string) => {
  const [row] = await env.prisma.$queryRaw<
    { ok: boolean }[]
  >`SELECT participant_id_check(${id}) AS ok`;
  return row!.ok;
};

/** Every single-digit change and every adjacent swap of the digits of a valid ID (Damm catches all of them). */
function typosOf(id: string): string[] {
  const out = new Set<string>();
  const digits = id.slice(2);
  for (let i = 0; i < digits.length; i++) {
    for (let d = 0; d <= 9; d++)
      if (String(d) !== digits[i])
        out.add(id.slice(0, 2) + digits.slice(0, i) + d + digits.slice(i + 1));
    if (i + 1 < digits.length && digits[i] !== digits[i + 1])
      out.add(
        id.slice(0, 2) + digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2),
      );
  }
  return [...out];
}

describe('the database draws and checks the ID', () => {
  it('gives every new registration one: ON, 10 digits and a valid check digit, never sequential', async () => {
    const a = await registered();
    const b = await registered();
    for (const r of [a, b]) {
      expect(r.participantId).toMatch(/^ON[0-9]{11}$/);
      expect(isParticipantId(r.participantId)).toBe(true);
    }
    expect(a.participantId).not.toBe(b.participantId);
    expect(
      Math.abs(Number(a.participantId.slice(2, 12)) - Number(b.participantId.slice(2, 12))),
    ).not.toBe(1);
  });

  it('draws only valid IDs for both prefixes and refuses any other prefix', async () => {
    const rows = await env.prisma.$queryRaw<{ id: string }[]>`
      SELECT gen_participant_id() AS id FROM generate_series(1, 1000)`;
    expect(rows.every((r) => isParticipantId(r.id) && r.id.startsWith('ON'))).toBe(true);
    // 1000 draws from 10^10: the digits spread over the space (no fixed or sequential part).
    expect(new Set(rows.map((r) => r.id.slice(2, 4))).size).toBeGreaterThan(80);
    const [of] = await env.prisma.$queryRaw<
      { id: string }[]
    >`SELECT gen_participant_id('OF') AS id`;
    expect(of!.id.startsWith('OF') && isParticipantId(of!.id)).toBe(true);
    await expect(env.prisma.$queryRaw`SELECT gen_participant_id('XX')`).rejects.toThrow(
      /unknown prefix/,
    );
  });

  it('agrees with @sirat/shared both ways, including every typo of an ID', async () => {
    const [vector] = await env.prisma.$queryRaw<
      { d: number }[]
    >`SELECT participant_damm('572') AS d`;
    expect([vector!.d, dammDigit('572')]).toEqual([4, 4]); // Damm's published example
    for (let i = 0; i < 50; i++) {
      const body = String(randomInt(0, 10_000_000_000)).padStart(10, '0');
      const id = `ON${body}${dammDigit(body)}`;
      expect([isParticipantId(id), await sqlCheck(id)]).toEqual([true, true]);
    }
    const [drawn] = await env.prisma.$queryRaw<{ id: string }[]>`SELECT gen_participant_id() AS id`;
    const typos = typosOf(drawn!.id);
    expect(typos.length).toBeGreaterThan(90);
    for (const typo of typos)
      expect([typo, isParticipantId(typo), await sqlCheck(typo)]).toEqual([typo, false, false]);
    for (const bad of [drawn!.id.toLowerCase(), `OX${drawn!.id.slice(2)}`, drawn!.id.slice(0, 12)])
      expect([bad, isParticipantId(bad), await sqlCheck(bad)]).toEqual([bad, false, false]);
  });

  it('the CHECK refuses an invalid ID and UNIQUE refuses a copy', async () => {
    const a = await registered();
    const b = await registered();
    const typo = typosOf(a.participantId)[0]!;
    await expect(
      env.prisma.registration.update({ where: { id: a.id }, data: { participantId: typo } }),
    ).rejects.toThrow(/registrations_participant_id_check/);
    await expect(
      env.prisma.registration.update({
        where: { id: b.id },
        data: { participantId: a.participantId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (await env.prisma.registration.findUniqueOrThrow({ where: { id: b.id } })).participantId,
    ).toBe(b.participantId);
  });
});

describe('settlement, the result page, the dashboard and the email', () => {
  it('the new account gets its ID: the result page shows it for 24 hours, /me always, the email carries it, the audit never', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    const enqueue = jest.spyOn(env.app.get(EmailQueue), 'enqueue').mockResolvedValue(true);
    let calls: Parameters<EmailQueue['enqueue']>[];
    try {
      await env.verifier.verify(s.paymentId, 'callback');
    } finally {
      calls = [...enqueue.mock.calls];
      enqueue.mockRestore();
    }
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    const registration = await env.prisma.registration.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const id = registration.participantId;
    expect(isParticipantId(id)).toBe(true);

    // The result page (this browser's attempt cookie).
    const call = caller(env.base);
    const current = await (
      await call('GET', '/registrations/current', { cookie: s.cookie })
    ).json();
    expect(current).toMatchObject({ state: 'completed', participantId: id });

    // The confirmation email: its own key, the registrant's address, the ID as the card shows it.
    const [kind, key, message] = calls.find(([k]) => k === 'registration-confirmed') ?? [];
    expect([kind, key, message?.to]).toEqual([
      'registration-confirmed',
      `registration-confirmed.${registration.id}`,
      s.email,
    ]);
    expect(message?.text).toContain(formatParticipantId(id));
    expect(message?.html).toContain(formatParticipantId(id));
    expect(calls.some(([k]) => k === 'verify-email')).toBe(true); // A2's email still goes

    // Never in the audit.
    const audit = await env.prisma.auditLog.findMany({ where: { entityId: user.id } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(id.slice(2));

    // The dashboard.
    const issued = await env.sessions.start(
      { id: user.id, role: user.role },
      { ip: '203.0.113.9', userAgent: 'jest' },
    );
    const me = await (
      await call('GET', '/registrations/me', { cookie: `${ACCESS_COOKIE}=${issued.accessToken}` })
    ).json();
    expect(me).toMatchObject({ registered: true, participantId: id });

    // After the window the result page stops showing it (a shared computer); the dashboard and the email keep it.
    await env.prisma.pendingRegistration.updateMany({
      where: { userId: user.id },
      data: { completedAt: new Date(Date.now() - (PARTICIPANT_ID_SHOWN_HOURS * 60 + 1) * 60_000) },
    });
    const later = await (await call('GET', '/registrations/current', { cookie: s.cookie })).json();
    expect(later).toMatchObject({ state: 'completed', participantId: null });
  });

  it('an attempt that is not completed shows no ID', async () => {
    const s = await startRegistration(env);
    const current = await (
      await caller(env.base)('GET', '/registrations/current', { cookie: s.cookie })
    ).json();
    expect(current).toMatchObject({ state: 'awaiting_payment', participantId: null });
  });
});

describe('the backfill', () => {
  function prismaCli(args: string[], url: string): string {
    return execFileSync('prisma', args, {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      shell: process.platform === 'win32',
    });
  }

  /** A copy of the schema folder with only the migrations before this one. */
  function migrationsBefore(): string {
    const all = readdirSync(join(PRISMA_DIR, 'migrations')).sort();
    const mine = all.find((d) => d.endsWith(MIGRATION_SUFFIX));
    if (!mine) throw new Error('participant_id migration not found');
    const dir = mkdtempSync(join(tmpdir(), 'sirat-pre-pid-'));
    cpSync(join(PRISMA_DIR, 'schema.prisma'), join(dir, 'schema.prisma'));
    cpSync(
      join(PRISMA_DIR, 'migrations', 'migration_lock.toml'),
      join(dir, 'migrations', 'migration_lock.toml'),
    );
    for (const d of all.filter((d) => d < mine && !d.endsWith('.toml')))
      cpSync(join(PRISMA_DIR, 'migrations', d), join(dir, 'migrations', d), { recursive: true });
    return dir;
  }

  it('gives every existing registration a valid, unique ID, then draws for new ones', async () => {
    const base = new URL(process.env.TEST_DATABASE_URL as string);
    const name = `sirat_pid_${randomUUID().slice(0, 8)}_test`;
    const url = new URL(base.toString());
    url.pathname = `/${name}`;
    const adminUrl = new URL(base.toString());
    adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    const before = migrationsBefore();
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // generated name: safe identifier
      prismaCli(['migrate', 'deploy', '--schema', join(before, 'schema.prisma')], url.toString());
      // Registrations made before the column existed. The attempts and payments go in by raw SQL: the client's model
      // is the newest schema (later migrations add columns), and this database stops before this migration.
      const old: Prisma.RegistrationCreateManyInput[] = [];
      for (let i = 0; i < 5; i++) {
        const user = await makeUser(db, { role: 'student' });
        const attemptId = randomUUID();
        const paymentId = randomUUID();
        await db.$executeRaw`
          INSERT INTO "pending_registrations" ("id", "email", "phone", "name", "start_request_id",
                                               "resume_token_hash", "updated_at")
          VALUES (${attemptId}::uuid, ${`b${i}-${randomUUID().slice(0, 8)}@test.invalid`}, ${testPhone()},
                  'Backfill Student', ${randomUUID()}::uuid, ${randomUUID()}, now())`;
        await db.$executeRaw`
          INSERT INTO "payments" ("id", "pending_registration_id", "user_id", "invoice_number", "amount_minor",
                                  "currency", "pay_with_charge", "gateway_account", "gateway_env", "expires_at",
                                  "updated_at")
          VALUES (${paymentId}::uuid, ${attemptId}::uuid, ${user.id}::uuid, ${testInvoice()}, 40000, 'BDT', false,
                  'test-account', 'fake', now() + interval '1 hour', now())`;
        await db.$executeRaw`UPDATE "payments" SET "status" = 'pending' WHERE "id" = ${paymentId}::uuid`;
        await db.$executeRaw`
          UPDATE "payments" SET "status" = 'paid', "trx_id" = ${`TRX${randomUUID().slice(0, 12)}`},
                                "paid_at" = now(), "paid_amount_minor" = 40000
          WHERE "id" = ${paymentId}::uuid`;
        old.push({ userId: user.id, paymentId });
      }
      await db.registration.createMany({ data: old });

      prismaCli(['migrate', 'deploy'], url.toString());
      const ids = await db.$queryRaw<
        { id: string }[]
      >`SELECT "participant_id" AS id FROM "registrations"`;
      expect(ids).toHaveLength(5);
      expect(ids.every((r) => isParticipantId(r.id) && r.id.startsWith('ON'))).toBe(true);
      expect(new Set(ids.map((r) => r.id)).size).toBe(5);
      const [col] = await db.$queryRaw<{ nullable: string; dflt: string }[]>`
        SELECT is_nullable AS nullable, column_default AS dflt FROM information_schema.columns
        WHERE table_name = 'registrations' AND column_name = 'participant_id'`;
      expect(col).toEqual({ nullable: 'NO', dflt: 'gen_participant_id()' });
      const fresh = await registered(db);
      expect(isParticipantId(fresh.participantId)).toBe(true);
    } finally {
      await db.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(before, { recursive: true, force: true });
    }
  }, 120_000);
});
