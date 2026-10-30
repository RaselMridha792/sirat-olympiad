/** Single-use email tokens against the *_test database (RULEBOOK §5). */
import { createHash, randomBytes } from 'node:crypto';
import { AuthTokenType, type PrismaClient } from '@prisma/client';
import { EMAIL_TOKEN_TTL_MS, EmailTokenService } from '../src/modules/auth/email-tokens.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { makeUser, testPrisma } from './helpers';

const prisma: PrismaClient = testPrisma();
const tokens = new EmailTokenService(prisma as unknown as PrismaService);
const { email_verify: VERIFY, password_reset: RESET } = AuthTokenType;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

afterAll(async () => {
  await prisma.$disconnect();
});

describe('EmailTokenService', () => {
  it('issues 32 random bytes as a 43-character token, storing only its hash, with the type-specific lifetime', async () => {
    const user = await makeUser(prisma);
    const before = Date.now();
    const issued = await tokens.issue(user.id, RESET);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await prisma.authToken.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.tokenHash).toBe(sha256(issued.token));
    expect(await prisma.authToken.count({ where: { tokenHash: issued.token } })).toBe(0);
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(EMAIL_TOKEN_TTL_MS[RESET] - 5_000);
    expect(ttl).toBeLessThanOrEqual(EMAIL_TOKEN_TTL_MS[RESET] + 1_000);
    expect(EMAIL_TOKEN_TTL_MS).toEqual({ email_verify: 86_400_000, password_reset: 1_800_000 });
  });

  it('can be used exactly once', async () => {
    const user = await makeUser(prisma);
    const { token } = await tokens.issue(user.id, VERIFY);
    await expect(tokens.consume(token, VERIFY)).resolves.toEqual({ userId: user.id });
    await expect(tokens.consume(token, VERIFY)).resolves.toBeNull();
  });

  it('refuses an unknown, malformed, other-type or expired token', async () => {
    const user = await makeUser(prisma);
    const { id, token } = await tokens.issue(user.id, VERIFY);
    await expect(tokens.consume(randomBytes(32).toString('base64url'), VERIFY)).resolves.toBeNull();
    await expect(tokens.consume('short', VERIFY)).resolves.toBeNull();
    await expect(tokens.consume(token, RESET)).resolves.toBeNull();
    await prisma.authToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(tokens.consume(token, VERIFY)).resolves.toBeNull();
  });

  it('retires earlier unused tokens of the same type when a new one is issued, but not other types', async () => {
    const user = await makeUser(prisma);
    const first = await tokens.issue(user.id, RESET);
    const verify = await tokens.issue(user.id, VERIFY);
    const second = await tokens.issue(user.id, RESET);
    await expect(tokens.consume(first.token, RESET)).resolves.toBeNull();
    await expect(tokens.consume(second.token, RESET)).resolves.toEqual({ userId: user.id });
    await expect(tokens.consume(verify.token, VERIFY)).resolves.toEqual({ userId: user.id });
  });

  it('lets exactly one of several simultaneous uses succeed', async () => {
    const user = await makeUser(prisma);
    const { token } = await tokens.issue(user.id, RESET);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => tokens.consume(token, RESET)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
