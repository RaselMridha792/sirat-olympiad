import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CleanupLimits } from './session-cleanup';

/** One batch: a DELETE or UPDATE of at most `limit` rows (… WHERE id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)). */
export type Batch = (tx: Prisma.TransactionClient, limit: number) => Prisma.PrismaPromise<number>;

export interface Drained {
  count: number;
  batches: number;
  /** The cap was reached with a full last batch: the next run goes on. */
  more: boolean;
}

/**
 * Runs `batch` until one comes back short, or `maxBatches` were run. Each batch is its own short transaction under
 * SET LOCAL statement_timeout (safe behind PgBouncer's transaction pooling), so a big backlog never holds a lock or a
 * connection for long, and a retry only does what is left.
 */
export async function drainBatches(
  prisma: PrismaService,
  limits: CleanupLimits,
  batch: Batch,
): Promise<Drained> {
  const { batchSize, maxBatches, statementTimeoutMs } = limits;
  let count = 0;
  for (let batches = 1; batches <= maxBatches; batches += 1) {
    const n = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
      return batch(tx, batchSize);
    });
    count += n;
    if (n < batchSize) return { count, batches, more: false };
  }
  return { count, batches: maxBatches, more: true };
}
