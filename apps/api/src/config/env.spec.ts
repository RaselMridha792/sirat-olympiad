import { randomBytes } from 'node:crypto';
import { emailConfigProblem, secretProblem, validateEnv, validateWorkerEnv } from './env';

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

describe('validateEnv: session cookies', () => {
  it('marks cookies Secure by default', () => {
    expect(validateEnv(valid()).COOKIE_SECURE).toBe('true');
  });

  it('allows insecure cookies only outside production', () => {
    expect(
      validateEnv({ ...valid(), NODE_ENV: 'development', COOKIE_SECURE: 'false' }),
    ).toMatchObject({ COOKIE_SECURE: 'false' });
    expect(() => validateEnv({ ...valid(), COOKIE_SECURE: 'false' })).toThrow(
      /never with NODE_ENV=production/,
    );
  });

  it('rejects anything but true or false', () => {
    expect(() => validateEnv({ ...valid(), COOKIE_SECURE: 'no' })).toThrow(/COOKIE_SECURE/);
  });
});

describe('validateWorkerEnv: email (owner: Amazon SES in production, Mailpit in development)', () => {
  const worker = (extra: Record<string, string>) => ({
    ...valid(),
    EMAIL_FROM: 'Sirat Olympiad <no-reply@sirat.test>',
    ...extra,
  });

  it('accepts Mailpit with a URL', () => {
    expect(() =>
      validateWorkerEnv(worker({ EMAIL_PROVIDER: 'mailpit', MAILPIT_URL: 'http://mailpit:8025' })),
    ).not.toThrow();
  });

  it('refuses to start without a configured provider', () => {
    expect(() => validateWorkerEnv(worker({}))).toThrow(/EMAIL_PROVIDER must be ses or mailpit/);
    expect(() => validateWorkerEnv(worker({ EMAIL_PROVIDER: 'mailpit' }))).toThrow(/MAILPIT_URL/);
  });

  it('no longer knows Resend', () => {
    expect(() => validateEnv({ ...valid(), EMAIL_PROVIDER: 'resend' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('keeps the API itself free of email settings (only the worker sends)', () => {
    expect(() => validateEnv(valid())).not.toThrow();
    expect(emailConfigProblem(validateEnv(valid()))).toMatch(/EMAIL_PROVIDER/);
  });

  it('rejects a malformed sender', () => {
    expect(() => validateEnv({ ...valid(), EMAIL_FROM: 'not an address' })).toThrow(/EMAIL_FROM/);
  });
});

describe('validateEnv: blank values', () => {
  it('treats KEY= as not set, so blank optional settings never stop the API', () => {
    const env = validateEnv({
      ...valid(),
      EMAIL_PROVIDER: '',
      EMAIL_FROM: '',
      SES_ACCESS_KEY_ID: '',
      MAILPIT_URL: '',
      LOG_LEVEL: '',
    });
    expect(env.EMAIL_PROVIDER).toBeUndefined();
    expect(env.COOKIE_SECURE).toBe('true');
  });

  it('still refuses a blank required variable, by name', () => {
    expect(() => validateEnv({ ...valid(), DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});

describe('validateWorkerEnv: Amazon SES (owner, 2026-10-31)', () => {
  const ses = (extra: Record<string, string>) => ({
    ...valid(),
    EMAIL_PROVIDER: 'ses',
    EMAIL_FROM: 'Sirat Olympiad <no-reply@sirat.test>',
    SES_REGION: 'ap-south-1',
    SES_ACCESS_KEY_ID: 'AKIA4QWERTYUIOPASDFG',
    SES_SECRET_ACCESS_KEY: randomBytes(30).toString('base64'),
    ...extra,
  });

  it('accepts a region and an IAM user key pair', () => {
    expect(() => validateWorkerEnv(ses({}))).not.toThrow();
  });

  it.each([
    ['no region', { SES_REGION: '' }, /SES_REGION/],
    ['no access key id', { SES_ACCESS_KEY_ID: '' }, /SES_ACCESS_KEY_ID/],
    ['a temporary (ASIA) key', { SES_ACCESS_KEY_ID: 'ASIA4QWERTYUIOPASDFG' }, /SES_ACCESS_KEY_ID/],
    [
      "AWS's documentation example key",
      { SES_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE' },
      /SES_ACCESS_KEY_ID/,
    ],
    ['no secret', { SES_SECRET_ACCESS_KEY: '' }, /SES_SECRET_ACCESS_KEY/],
    [
      "AWS's documentation example secret",
      { SES_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      /SES_SECRET_ACCESS_KEY/,
    ],
  ])('refuses %s, never echoing a key', (_label, extra, reason) => {
    let message = '';
    try {
      validateWorkerEnv(ses(extra as Record<string, string>));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(reason);
    for (const value of Object.values(extra as Record<string, string>))
      if (value) expect(message).not.toContain(value);
  });

  it('refuses a region that is not an AWS region name', () => {
    expect(() => validateEnv({ ...valid(), SES_REGION: 'mumbai' })).toThrow(/SES_REGION/);
  });
});
