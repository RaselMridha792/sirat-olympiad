import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { EMAIL_JOB_OPTIONS, ENQUEUE_TIMEOUT_MS, EmailQueue } from './email-queue.service';

const add = jest.fn();
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, close: jest.fn() })),
}));

const ADDRESS = 'student@example.com';
const message = { to: ADDRESS, subject: 'Verify', text: 'Open https://x.test/verify?t=TOKEN' };
const queueWith = (status: string) => new EmailQueue({ status } as unknown as Redis, 'email-test');

describe('EmailQueue (owner: a failed email never blocks registration, payment or login)', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    add.mockReset();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const logged = () => JSON.stringify(error.mock.calls);

  it('queues the job with retries and the key as job id', async () => {
    add.mockResolvedValue({ id: 'verify-email.1' });
    await expect(
      queueWith('ready').enqueue('verify-email', 'verify-email.1', message),
    ).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith(
      'verify-email',
      { kind: 'verify-email', message },
      { ...EMAIL_JOB_OPTIONS, jobId: 'verify-email.1' },
    );
    expect(EMAIL_JOB_OPTIONS).toMatchObject({
      attempts: 8,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
    });
  });

  it('returns false at once when the queue Redis is not ready, logging kind and key only', async () => {
    await expect(queueWith('reconnecting').enqueue('verify-email', 'k1', message)).resolves.toBe(
      false,
    );
    expect(add).not.toHaveBeenCalled();
    expect(logged()).toContain('k1');
    expect(logged()).not.toContain(ADDRESS);
  });

  it('returns false instead of throwing when the queue rejects the job', async () => {
    add.mockRejectedValue(new Error(`boom for ${ADDRESS}`));
    await expect(queueWith('ready').enqueue('verify-email', 'k2', message)).resolves.toBe(false);
    expect(logged()).not.toContain(ADDRESS);
  });

  it('gives up after 2 s when the queue Redis hangs', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    add.mockReturnValue(new Promise(() => undefined));
    const pending = queueWith('ready').enqueue('verify-email', 'k3', message);
    await jest.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS + 10);
    await expect(pending).resolves.toBe(false);
    expect(ENQUEUE_TIMEOUT_MS).toBe(2_000);
  });
});
