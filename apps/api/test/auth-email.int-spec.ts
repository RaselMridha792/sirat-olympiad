/**
 * Email-link endpoints over HTTP (RULEBOOK §5): verify-email marks the address verified from its link and never logs
 * in; every bad link gets one answer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { AuthTokenType, type PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { EmailTokenService } from '../src/modules/auth/email-tokens.service';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let tokens: EmailTokenService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  tokens = app.get(EmailTokenService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

// A /64 of its own per run and per call: per-IP counters live in Redis across runs.
const run = randomUUID().slice(0, 4);
let nextIp = 0;
const newIp = () => `2001:db8:${run}:${(nextIp += 1).toString(16)}::1`;

function post(path: string, body: unknown, csrf = true) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': newIp(),
  };
  if (csrf) headers['x-requested-with'] = 'XMLHttpRequest';
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const verify = (token: string, csrf = true) => post('/api/auth/verify-email', { token }, csrf);
const unverified = () =>
  makeUser(prisma, { email: `v-${randomUUID().slice(0, 8)}@test.invalid`, emailVerifiedAt: null });

describe('POST /api/auth/verify-email', () => {
  it('marks the address verified, sets no cookie, and audits it once', async () => {
    const user = await unverified();
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    const res = await verify(token);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([]); // verification never logs in
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.email_verified', actorId: user.id } }),
    ).toBe(1);
  });

  it('answers a used, expired, unknown, reset-type or blocked-account link with one 400', async () => {
    const user = await unverified();
    const used = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(used.token)).status).toBe(204);
    const other = await unverified();
    const expired = await tokens.issue(other.id, AuthTokenType.email_verify);
    await prisma.authToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const resetType = await tokens.issue(other.id, AuthTokenType.password_reset);
    const blocked = await unverified();
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    const blockedLink = await tokens.issue(blocked.id, AuthTokenType.email_verify);

    for (const token of [
      used.token,
      expired.token,
      randomBytes(32).toString('base64url'),
      'short',
      resetType.token,
      blockedLink.token,
    ]) {
      const res = await verify(token);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(
        'This link is invalid or has expired',
      );
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(stored.emailVerifiedAt).toBeNull();
  });

  it('answers 204 for a valid link of an already verified account and changes nothing', async () => {
    const at = new Date('2026-10-01T10:00:00Z');
    const user = await makeUser(prisma, { emailVerifiedAt: at });
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(token)).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).toEqual(at);
  });

  it('lets exactly one of two simultaneous uses succeed, and needs the CSRF header', async () => {
    const user = await unverified();
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(token, false)).status).toBe(403);
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });
});
