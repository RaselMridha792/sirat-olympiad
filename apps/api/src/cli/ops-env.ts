/**
 * The settings the ops commands (ops-alert, ops-check) read, parsed explicitly. validateEnv cannot run outside the
 * Nest app: it converts numbers through class-transformer's decorator metadata, which tsx does not emit and which needs
 * reflect-metadata loaded. So these commands read only what they use, with the same rules as env.ts.
 */
export interface OpsEnv {
  REDIS_CACHE_URL: string;
  REDIS_QUEUE_URL: string;
  SECURITY_ALERT_EMAIL: string | undefined;
  SECURITY_ALERT_EMAILS_PER_HOUR: number;
  EXAM_QUEUE_NAME: string | undefined;
  PAYMENTS_QUEUE_NAME: string | undefined;
  HOUSEKEEPING_QUEUE_NAME: string | undefined;
  AMBASSADOR_QUEUE_NAME: string | undefined;
}

export class OpsEnvError extends Error {}

const QUEUE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const REDIS_URL = /^rediss?:\/\/\S+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Names a problem only by variable, never by value (values can be secrets or addresses). */
export function opsEnv(env: NodeJS.ProcessEnv = process.env): OpsEnv {
  const blank = (key: string) => (env[key] ?? '') === '';
  const redis = (key: string) => {
    const value = env[key] ?? '';
    if (!REDIS_URL.test(value)) throw new OpsEnvError(`${key} must be a redis:// URL`);
    return value;
  };
  const queue = (key: string) => {
    if (blank(key)) return undefined;
    if (!QUEUE_NAME.test(env[key]!)) throw new OpsEnvError(`${key} must be a plain queue name`);
    return env[key];
  };
  let perHour = 6;
  if (!blank('SECURITY_ALERT_EMAILS_PER_HOUR')) {
    perHour = Number(env.SECURITY_ALERT_EMAILS_PER_HOUR);
    if (!Number.isInteger(perHour) || perHour < 1 || perHour > 60)
      throw new OpsEnvError('SECURITY_ALERT_EMAILS_PER_HOUR must be a whole number from 1 to 60');
  }
  if (!blank('SECURITY_ALERT_EMAIL') && !EMAIL.test(env.SECURITY_ALERT_EMAIL!))
    throw new OpsEnvError('SECURITY_ALERT_EMAIL must be an email address');
  return {
    REDIS_CACHE_URL: redis('REDIS_CACHE_URL'),
    REDIS_QUEUE_URL: redis('REDIS_QUEUE_URL'),
    SECURITY_ALERT_EMAIL: blank('SECURITY_ALERT_EMAIL') ? undefined : env.SECURITY_ALERT_EMAIL,
    SECURITY_ALERT_EMAILS_PER_HOUR: perHour,
    EXAM_QUEUE_NAME: queue('EXAM_QUEUE_NAME'),
    PAYMENTS_QUEUE_NAME: queue('PAYMENTS_QUEUE_NAME'),
    HOUSEKEEPING_QUEUE_NAME: queue('HOUSEKEEPING_QUEUE_NAME'),
    AMBASSADOR_QUEUE_NAME: queue('AMBASSADOR_QUEUE_NAME'),
  };
}
