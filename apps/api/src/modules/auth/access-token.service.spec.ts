import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Role as PrismaRole } from '@prisma/client';
import { ROLES } from '@sirat/shared';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  AccessTokenService,
  accessTokenJwtOptions,
  type AuthUser,
} from './access-token.service';

const secret = randomBytes(32).toString('base64');
const service = new AccessTokenService(new JwtService(accessTokenJwtOptions(secret, 900)));
const user = (): AuthUser => ({ id: randomUUID(), role: 'student', sessionId: randomUUID() });
const now = () => Math.floor(Date.now() / 1000);
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Signs arbitrary claims with the real secret but none of the service's defaults. */
const raw = (payload: object, options: { algorithm?: 'HS256' | 'HS384' } = {}) =>
  new JwtService({ secret }).signAsync(payload, { algorithm: options.algorithm ?? 'HS256' });
const valid = (extra: object = {}) => ({
  sub: randomUUID(),
  sid: randomUUID(),
  role: 'student',
  iss: ACCESS_TOKEN_ISSUER,
  aud: ACCESS_TOKEN_AUDIENCE,
  exp: now() + 600,
  ...extra,
});

describe('AccessTokenService', () => {
  it('round-trips the session user (id, role, session id)', async () => {
    const u = user();
    await expect(service.verify(await service.sign(u))).resolves.toEqual(u);
  });

  it('signs HS256 with issuer, audience and the configured lifetime', async () => {
    const token = await service.sign(user());
    const [header, payload] = token
      .split('.')
      .slice(0, 2) // the third part is the signature, not JSON
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header).toMatchObject({ alg: 'HS256' });
    expect(payload).toMatchObject({ iss: ACCESS_TOKEN_ISSUER, aud: ACCESS_TOKEN_AUDIENCE });
    expect(payload.exp - payload.iat).toBe(900);
  });

  it.each([
    [
      'signed with another secret',
      () => new JwtService({ secret: randomBytes(32).toString('hex') }).signAsync(valid()),
    ],
    ['expired', () => raw(valid({ exp: now() - 5 }))],
    ['from another issuer', () => raw(valid({ iss: 'someone-else' }))],
    ['for another audience', () => raw(valid({ aud: 'another-app' }))],
    ['signed with another algorithm (HS384)', () => raw(valid(), { algorithm: 'HS384' })],
    [
      'unsigned (alg none)',
      async () => `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(valid())}.`,
    ],
    ['with an unknown role', () => raw(valid({ role: 'superadmin' }))],
    ['without a session id', () => raw(valid({ sid: undefined }))],
    ['without a subject', () => raw(valid({ sub: undefined }))],
    ['garbage', async () => 'not-a-jwt'],
  ])('rejects a token %s', async (_label, make) => {
    await expect(service.verify(await make())).resolves.toBeNull();
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const [h, , s] = (await service.sign(user())).split('.');
    const forged = `${h}.${b64url(valid({ role: 'admin' }))}.${s}`;
    await expect(service.verify(forged)).resolves.toBeNull();
  });

  it('knows exactly the roles of the database enum', () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
  });
});
