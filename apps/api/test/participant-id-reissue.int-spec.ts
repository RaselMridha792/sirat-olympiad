/**
 * "Issue a new participant ID" (DECISIONS "The participant ID", P1b): POST /admin/users/:id/participant-id. Admin only;
 * in one transaction the database draws a new ID (same prefix, never the old one), every session of the student ends,
 * and the audit records the reason and the count. The new ID goes only to the student's email: never to the response,
 * the audit or a log.
 */
import { dammDigit, formatParticipantId, isParticipantId } from '@sirat/shared';
import { EmailQueue } from '../src/modules/notifications/email-queue.service';
import { makePaidPayment, makeUser } from './helpers';
import { bootPaymentsApp, caller, loginAs, type PaymentsApp } from './payments-app';

let env: PaymentsApp;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootPaymentsApp();
  admin = await loginAs(env, 'admin');
}, 60_000);

afterAll(async () => {
  await env?.close();
});

afterEach(() => jest.restoreAllMocks());

const REASON = 'The student posted the admit card on Facebook';

async function registeredStudent() {
  const user = await makeUser(env.prisma, { role: 'student' });
  const payment = await makePaidPayment(env.prisma, user.id);
  const registration = await env.prisma.registration.create({
    data: { userId: user.id, paymentId: payment.id },
  });
  return { user, registration };
}

const reissue = (userId: string, cookie: string, body: unknown = { reason: REASON }) =>
  caller(env.base)('POST', `/admin/users/${userId}/participant-id`, { cookie, body });

describe('POST /admin/users/:id/participant-id', () => {
  it('draws a new ID, ends every session, audits the reason, and emails the ID only to the student', async () => {
    const { user, registration } = await registeredStudent();
    const old = registration.participantId;
    for (const ip of ['203.0.113.21', '203.0.113.22'])
      await env.sessions.start({ id: user.id, role: user.role }, { ip, userAgent: 'jest' });
    const enqueue = jest.spyOn(env.app.get(EmailQueue), 'enqueue').mockResolvedValue(true);

    const res = await reissue(user.id, admin.cookie);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ reissued: true, sessionsEnded: 2, emailQueued: true });

    const fresh = await env.prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    const id = fresh.participantId;
    expect(isParticipantId(id)).toBe(true);
    expect(id).not.toBe(old);
    expect(id.slice(0, 2)).toBe(old.slice(0, 2));
    expect(await env.prisma.registration.count({ where: { participantId: old } })).toBe(0);
    expect(text).not.toContain(id.slice(2));
    expect(text).not.toContain(old.slice(2));

    expect(await env.prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    const audit = await env.prisma.auditLog.findFirstOrThrow({
      where: { action: 'payments.participant_id_reissued', entityId: user.id },
    });
    expect(audit).toMatchObject({ actorId: admin.id, entityType: 'user' });
    expect(audit.meta).toEqual({
      reason: REASON,
      sessionsEnded: 2,
      registrationId: registration.id,
    });
    expect(JSON.stringify(audit)).not.toContain(id.slice(2));
    expect(JSON.stringify(audit)).not.toContain(old.slice(2));

    const [kind, key, message] =
      enqueue.mock.calls.find(([k]) => k === 'participant-id-reissued') ?? [];
    expect([kind, key, message?.to]).toEqual([
      'participant-id-reissued',
      `participant-id-reissued.${audit.id}`,
      user.email,
    ]);
    expect(message?.text).toContain(formatParticipantId(id));
    expect(message?.text).not.toContain(formatParticipantId(old));
  });

  it('keeps the prefix (an OF ID stays OF) and still answers when the email cannot be queued', async () => {
    const { user, registration } = await registeredStudent();
    const offline = `OF4821093755${dammDigit('4821093755')}`;
    await env.prisma.registration.update({
      where: { id: registration.id },
      data: { participantId: offline },
    });
    jest.spyOn(env.app.get(EmailQueue), 'enqueue').mockResolvedValue(false);
    const res = await reissue(user.id, admin.cookie);
    expect(await res.json()).toEqual({ reissued: true, sessionsEnded: 0, emailQueued: false });
    const fresh = await env.prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(fresh.participantId.startsWith('OF') && isParticipantId(fresh.participantId)).toBe(true);
    expect(fresh.participantId).not.toBe(offline);
  });

  it('refuses a short reason, extra fields and a bad id (400), an account without a registration (404), and changes nothing', async () => {
    const { user, registration } = await registeredStudent();
    expect((await reissue(user.id, admin.cookie, { reason: 'too short' })).status).toBe(400);
    expect(
      (await reissue(user.id, admin.cookie, { reason: REASON, participantId: 'ON00000000000' }))
        .status,
    ).toBe(400);
    expect((await reissue('not-a-uuid', admin.cookie)).status).toBe(400);
    const plain = await makeUser(env.prisma, { role: 'student' });
    expect((await reissue(plain.id, admin.cookie)).status).toBe(404);
    expect((await reissue('0190f000-0000-7000-8000-00000000dead', admin.cookie)).status).toBe(404);
    expect(
      (await env.prisma.registration.findUniqueOrThrow({ where: { id: registration.id } }))
        .participantId,
    ).toBe(registration.participantId);
    expect(
      await env.prisma.auditLog.count({
        where: {
          action: 'payments.participant_id_reissued',
          entityId: { in: [user.id, plain.id] },
        },
      }),
    ).toBe(0);
  });

  it('is for admins only: 401 without a session, 403 for a student, a manager or the student themself', async () => {
    const { user, registration } = await registeredStudent();
    expect((await reissue(user.id, '')).status).toBe(401);
    for (const role of ['student', 'manager', 'ambassador', 'jury'] as const) {
      const someone = await loginAs(env, role);
      expect([role, (await reissue(user.id, someone.cookie)).status]).toEqual([role, 403]);
    }
    const self = await env.sessions.start(
      { id: user.id, role: user.role },
      { ip: '203.0.113.23', userAgent: 'jest' },
    );
    const { ACCESS_COOKIE } = await import('../src/modules/auth/access-token.service');
    expect((await reissue(user.id, `${ACCESS_COOKIE}=${self.accessToken}`)).status).toBe(403);
    expect(
      (await env.prisma.registration.findUniqueOrThrow({ where: { id: registration.id } }))
        .participantId,
    ).toBe(registration.participantId);
  });
});
