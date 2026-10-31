import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { AppFacts, QueueFacts } from './ops-rules';

/*
 * The app facts for ops-check (LAUNCH-PLAN §6, L11), read from the queue Redis only: each queue's workers, waiting
 * jobs, the age of the oldest one, the jobs that failed for good since the last run (BullMQ moves a job to "failed"
 * only after its last attempt), the payments reconciliation schedule, and the queue Redis memory. Reads only.
 */

export interface QueueSpec {
  name: QueueFacts['name'];
  /** The BullMQ queue name (EXAM_QUEUE_NAME and PAYMENTS_QUEUE_NAME change it in tests). */
  queueName: string;
  /** A job name whose failure is critical (payments' verify, RULEBOOK §9). */
  criticalJob?: string;
}

/** How far back the failed list is read; more failures than this in 5 minutes is already an incident. */
const FAILED_SCAN = 200;

export async function queueFacts(
  redis: Redis,
  spec: QueueSpec,
  sinceMs: number,
  nowMs: number,
): Promise<QueueFacts> {
  const queue = new Queue(spec.queueName, { connection: redis });
  try {
    const [workers, counts, oldest, failed] = await Promise.all([
      queue.getWorkers(),
      queue.getJobCounts('wait', 'prioritized'),
      queue.getJobs(['wait', 'prioritized'], 0, 0, true),
      queue.getJobs(['failed'], 0, FAILED_SCAN - 1, false),
    ]);
    const recent = failed.filter((job) => job && (job.finishedOn ?? 0) > sinceMs);
    const oldestAt = oldest[0]?.timestamp;
    return {
      name: spec.name,
      workers: workers.length,
      waiting: (counts.wait ?? 0) + (counts.prioritized ?? 0),
      oldestWaitingSeconds: oldestAt ? Math.max(0, Math.round((nowMs - oldestAt) / 1000)) : null,
      failedSinceLastRun: recent.length,
      failedVerifySinceLastRun: spec.criticalJob
        ? recent.filter((job) => job.name === spec.criticalJob).length
        : 0,
    };
  } finally {
    await queue.close();
  }
}

/** Seconds the scheduler's next run is overdue (0 = on time), or null when the job has no scheduler at all. */
export async function schedulerOverdueSeconds(
  redis: Redis,
  queueName: string,
  jobName: string,
  nowMs: number,
): Promise<number | null> {
  const queue = new Queue(queueName, { connection: redis });
  try {
    const schedulers = await queue.getJobSchedulers(0, 50, true);
    const next = schedulers.find((s) => s.name === jobName)?.next;
    if (typeof next !== 'number') return null;
    return Math.max(0, Math.round((nowMs - next) / 1000));
  } finally {
    await queue.close();
  }
}

/** `used_memory` of the queue Redis, in MB. */
export async function redisMemoryMb(redis: Redis): Promise<number> {
  const info = await redis.info('memory');
  const bytes = Number(/^used_memory:(\d+)/m.exec(info)?.[1] ?? 0);
  return Math.round(bytes / (1024 * 1024));
}

export async function collectAppFacts(
  redis: Redis,
  options: {
    queues: QueueSpec[];
    reconcile: { queueName: string; jobName: string; intervalSeconds: number };
    sinceMs: number;
    nowMs: number;
  },
): Promise<AppFacts> {
  const [queues, reconcileOverdueSeconds, queueRedisMemoryMb] = await Promise.all([
    Promise.all(options.queues.map((q) => queueFacts(redis, q, options.sinceMs, options.nowMs))),
    schedulerOverdueSeconds(
      redis,
      options.reconcile.queueName,
      options.reconcile.jobName,
      options.nowMs,
    ),
    redisMemoryMb(redis),
  ]);
  return {
    queues,
    reconcileOverdueSeconds,
    reconcileIntervalSeconds: options.reconcile.intervalSeconds,
    queueRedisMemoryMb,
  };
}
