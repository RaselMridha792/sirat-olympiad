import { randomBytes } from 'node:crypto';
import { secretProblem, validateEnv } from './env';

const strongSecret = () => randomBytes(32).toString('base64');
const valid = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@pgbouncer:6432/sirat?pgbouncer=true',
  REDIS_CACHE_URL: 'redis://redis-cache:6379',
  REDIS_QUEUE_URL: 'redis://redis-queue:6379',
  JWT_ACCESS_SECRET: strongSecret(),
});

describe('validateEnv (A2.0 gate 3: no placeholder or weak signing secrets)', () => {
  it('accepts a complete environment with a random secret', () => {
    expect(() => validateEnv(valid())).not.toThrow();
    expect(() =>
      validateEnv({ ...valid(), JWT_ACCESS_SECRET: randomBytes(32).toString('hex') }),
    ).not.toThrow();
  });

  it.each([
    ['the old committed example value', 'fake-access-secret-min-32-chars-long-xxxx', /placeholder/],
    ['a "change me" value', 'please-change-me-before-going-live-0123456789', /placeholder/],
    ['an "example" value', 'example-signing-key-for-docs-0123456789-abcdef', /placeholder/],
    ['31 characters', 'Ab3$'.repeat(8).slice(0, 31), /at least 32/],
    ['a repetitive value', 'a'.repeat(48), /too repetitive/],
    ['an alternating value', 'ab'.repeat(24), /too repetitive/],
  ])('rejects %s, in every NODE_ENV, without echoing it', (_label, secret, reason) => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      let message = '';
      try {
        validateEnv({ ...valid(), NODE_ENV, JWT_ACCESS_SECRET: secret });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(reason);
      expect(message).not.toContain(secret);
    }
  });

  it('rejects a missing secret by name', () => {
    expect(() => validateEnv({ ...valid(), JWT_ACCESS_SECRET: '' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it.each([
    ['DATABASE_URL', 'mysql://u:p@db/x'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_CACHE_URL', 'x'],
    ['REDIS_QUEUE_URL', 'http://redis-queue:6379'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => validateEnv({ ...valid(), [name]: value })).toThrow(new RegExp(name));
  });

  it('secretProblem returns null for a good secret', () => {
    expect(secretProblem(strongSecret())).toBeNull();
  });
});
