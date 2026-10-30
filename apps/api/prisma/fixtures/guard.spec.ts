import { assertFixturesAllowed, FIXTURE_CONFIRM_VALUE } from './guard';

const ok = {
  NODE_ENV: 'development',
  ALLOW_DEV_FIXTURES: FIXTURE_CONFIRM_VALUE,
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:16432/sirat?pgbouncer=true',
};

describe('assertFixturesAllowed', () => {
  it('allows a local development database with explicit confirmation', () => {
    expect(() => assertFixturesAllowed(ok)).not.toThrow();
    expect(() => assertFixturesAllowed({ ...ok, NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost/x' })).not.toThrow();
  });

  it('refuses in production even when everything else is set', () => {
    expect(() => assertFixturesAllowed({ ...ok, NODE_ENV: 'production' })).toThrow(/NODE_ENV/);
  });

  it('refuses when NODE_ENV is unset', () => {
    expect(() => assertFixturesAllowed({ ...ok, NODE_ENV: undefined })).toThrow(/NODE_ENV/);
  });

  it('refuses without the explicit confirmation value', () => {
    expect(() => assertFixturesAllowed({ ...ok, ALLOW_DEV_FIXTURES: 'true' })).toThrow(/ALLOW_DEV_FIXTURES/);
    expect(() => assertFixturesAllowed({ ...ok, ALLOW_DEV_FIXTURES: undefined })).toThrow(/ALLOW_DEV_FIXTURES/);
  });

  it('refuses a non-local database host (compose/production hostnames)', () => {
    expect(() => assertFixturesAllowed({ ...ok, DATABASE_URL: 'postgresql://u:p@pgbouncer:6432/sirat' })).toThrow(/not local/);
    expect(() => assertFixturesAllowed({ ...ok, DATABASE_URL: 'postgresql://u:p@db.example.com/sirat' })).toThrow(/not local/);
  });

  it('refuses a missing or invalid DATABASE_URL', () => {
    expect(() => assertFixturesAllowed({ ...ok, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => assertFixturesAllowed({ ...ok, DATABASE_URL: 'not a url' })).toThrow(/valid URL/);
  });
});
