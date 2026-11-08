import { Prisma } from '@prisma/client';
import { DEMO_STALE_MINUTES, type DemoRefusal } from '@sirat/shared';
import { paymentsAllowDemo } from '../payments/demo/allow-demo';
import type { PaymentConfig } from '../payments/payment.config';

type Tx = Prisma.TransactionClient;

/** A named refusal (DEMO_REFUSALS): the API answers 409 with the code, the CLI prints it. */
export class DemoRefusalError extends Error {
  constructor(readonly code: DemoRefusal) {
    super(code);
  }
}

export interface DemoRequest {
  /** The admin; null for the CLI (an operator at the server). */
  actorId: string | null;
  ip: string | null;
  reason: string;
  /** 'api' or 'cli', in the audit row. */
  via: 'api' | 'cli';
}

/**
 * Starts a load, for the API and the CLI alike: the one batch ('loading') and its audit row, after payments' guard.
 * Refuses demo_busy (a job runs), demo_exists (remove the batch first), payments_live, real_payments.
 */
export async function beginDemoLoad(
  tx: Tx,
  req: DemoRequest,
  payments: PaymentConfig,
): Promise<string> {
  await assertCanLoad(tx, payments, true);
  const batch = await tx.demoBatch.create({
    data: { status: 'loading', reason: req.reason, createdById: req.actorId },
    select: { id: true },
  });
  await auditDemo(tx, req, 'demo.load_requested', batch.id);
  return batch.id;
}

/**
 * The cheap refusals of a load (no batch may exist; payments' guard), so a refused click costs no password hash.
 * `lock`: inside the load transaction, the batch row is locked (the API reads once before hashing without it).
 */
export async function assertCanLoad(db: Tx, payments: PaymentConfig, lock = false): Promise<void> {
  const current = await currentBatch(db, lock);
  if (current)
    throw new DemoRefusalError(
      running(current.status) && !current.stale ? 'demo_busy' : 'demo_exists',
    );
  const allowed = await paymentsAllowDemo(db, payments);
  if (!allowed.ok) throw new DemoRefusalError(allowed.reason);
  // The demo brings its own rounds (101-103): only beside the real Round 1 alone (the rounds generator checks again).
  const realRounds = await db.round.count({ where: { demoBatchId: null, sortOrder: { not: 1 } } });
  if (realRounds > 0) throw new DemoRefusalError('real_rounds_present');
}

/**
 * Starts a removal: the batch becomes 'clearing' with its audit row. Refuses demo_absent, and demo_busy while a job
 * runs. A batch abandoned in 'loading' or 'clearing' (DEMO_STALE_MINUTES) may be removed; if the removal is refused,
 * it then goes back to 'failed'.
 */
export async function beginDemoClear(
  tx: Tx,
  req: DemoRequest,
): Promise<{ batchId: string; previous: 'loaded' | 'failed' }> {
  const current = await currentBatch(tx, true);
  if (!current) throw new DemoRefusalError('demo_absent');
  if (running(current.status) && !current.stale) throw new DemoRefusalError('demo_busy');
  const previous = current.status === 'loaded' ? 'loaded' : 'failed';
  await tx.demoBatch.update({ where: { id: current.id }, data: { status: 'clearing' } });
  await auditDemo(
    tx,
    req,
    'demo.clear_requested',
    current.id,
    current.stale ? current.status : null,
  );
  return { batchId: current.id, previous };
}

/** Two loads at once: the second insert meets the one-batch unique index. */
export const isSecondBatch = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const running = (status: string) => status === 'loading' || status === 'clearing';

/** The one batch (locked for the transaction with `lock`), and whether it is abandoned (DEMO_STALE_MINUTES). */
async function currentBatch(
  db: Tx,
  lock: boolean,
): Promise<{ id: string; status: string; stale: boolean } | null> {
  const rows = lock
    ? await db.$queryRaw<{ id: string; status: string; stale: boolean }[]>`
        SELECT "id"::text AS "id", "status",
               "status" IN ('loading', 'clearing')
               AND "updated_at" < now() - make_interval(mins => ${DEMO_STALE_MINUTES}::int) AS "stale"
        FROM "demo_batches" ORDER BY "created_at" DESC LIMIT 1 FOR UPDATE`
    : await db.$queryRaw<{ id: string; status: string; stale: boolean }[]>`
        SELECT "id"::text AS "id", "status",
               "status" IN ('loading', 'clearing')
               AND "updated_at" < now() - make_interval(mins => ${DEMO_STALE_MINUTES}::int) AS "stale"
        FROM "demo_batches" ORDER BY "created_at" DESC LIMIT 1`;
  return rows[0] ?? null;
}

async function auditDemo(
  tx: Tx,
  req: DemoRequest,
  action: string,
  batchId: string,
  abandoned: string | null = null,
) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: req.actorId,
      entityType: 'demo_batch',
      entityId: batchId,
      ip: req.ip,
      // An abandoned batch's status before the removal (the stale rule), so the log tells why it was allowed.
      meta: { reason: req.reason, via: req.via, ...(abandoned ? { abandoned } : {}) },
    },
  });
}
