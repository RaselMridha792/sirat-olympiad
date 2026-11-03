import { OpsEnvError, opsEnv } from './ops-env';

/* The ops commands read their settings explicitly (validateEnv needs the Nest app's decorator metadata). */

const base = { REDIS_CACHE_URL: 'redis://cache:6379', REDIS_QUEUE_URL: 'redis://queue:6379' };

describe('opsEnv', () => {
  it('reads the settings with their defaults, as strings from the environment', () => {
    expect(opsEnv({ ...base })).toEqual({
      ...base,
      SECURITY_ALERT_EMAIL: undefined,
      SECURITY_ALERT_EMAILS_PER_HOUR: 6,
      EXAM_QUEUE_NAME: undefined,
      PAYMENTS_QUEUE_NAME: undefined,
      HOUSEKEEPING_QUEUE_NAME: undefined,
      AMBASSADOR_QUEUE_NAME: undefined,
      CERTIFICATES_QUEUE_NAME: undefined,
    });
    expect(
      opsEnv({
        ...base,
        SECURITY_ALERT_EMAIL: 'alerts@example.invalid',
        SECURITY_ALERT_EMAILS_PER_HOUR: '12',
        EXAM_QUEUE_NAME: 'exam-test-1',
        PAYMENTS_QUEUE_NAME: '',
      }),
    ).toMatchObject({
      SECURITY_ALERT_EMAIL: 'alerts@example.invalid',
      SECURITY_ALERT_EMAILS_PER_HOUR: 12,
      EXAM_QUEUE_NAME: 'exam-test-1',
      PAYMENTS_QUEUE_NAME: undefined,
    });
  });

  it.each([
    [{ REDIS_QUEUE_URL: base.REDIS_QUEUE_URL }, 'REDIS_CACHE_URL'],
    [{ ...base, REDIS_QUEUE_URL: 'http://queue' }, 'REDIS_QUEUE_URL'],
    [{ ...base, SECURITY_ALERT_EMAILS_PER_HOUR: '0' }, 'SECURITY_ALERT_EMAILS_PER_HOUR'],
    [{ ...base, SECURITY_ALERT_EMAILS_PER_HOUR: '6.5' }, 'SECURITY_ALERT_EMAILS_PER_HOUR'],
    [{ ...base, SECURITY_ALERT_EMAIL: 'not an address' }, 'SECURITY_ALERT_EMAIL'],
    [{ ...base, EXAM_QUEUE_NAME: 'exam queue' }, 'EXAM_QUEUE_NAME'],
    [{ ...base, HOUSEKEEPING_QUEUE_NAME: 'house keeping' }, 'HOUSEKEEPING_QUEUE_NAME'],
    [{ ...base, AMBASSADOR_QUEUE_NAME: 'ambassador points' }, 'AMBASSADOR_QUEUE_NAME'],
    [{ ...base, CERTIFICATES_QUEUE_NAME: 'cert ificates' }, 'CERTIFICATES_QUEUE_NAME'],
  ])('refuses a bad setting by name, never by value (%#)', (env, name) => {
    let message = '';
    try {
      opsEnv(env);
    } catch (e) {
      expect(e).toBeInstanceOf(OpsEnvError);
      message = (e as Error).message;
    }
    expect(message).toContain(name);
    for (const value of Object.values(env))
      if (value.length > 3) expect(message).not.toContain(value);
  });
});
