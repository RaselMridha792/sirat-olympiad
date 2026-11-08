import { Prisma } from '@prisma/client';
import type { DemoRefusal } from '@sirat/shared';
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
  const current = await currentBatch(tx);
  if (current) throw new DemoRefusalError(running(current.status) ? 'demo_busy' : 'demo_exists');
  const allowed = await paymentsAllowDemo(tx, payments);
  if (!allowed.ok) throw new DemoRefusalError(allowed.reason);
  const batch = await tx.demoBatch.create({
    data: { status: 'loading', reason: req.reason, createdById: req.actorId },
    select: { id: true },
  });
  await auditDemo(tx, req, 'demo.load_requested', batch.id);
  return batch.id;
}

/** Starts a removal: the batch becomes 'clearing' with its audit row. Refuses demo_absent, demo_busy. */
export async function beginDemoClear(
  tx: Tx,
  req: DemoRequest,
): Promise<{ batchId: string; previous: 'loaded' | 'failed' }> {
  const current = await currentBatch(tx);
  if (!current) throw new DemoRefusalError('demo_absent');
  if (current.status !== 'loaded' && current.status !== 'failed')
    throw new DemoRefusalError('demo_busy');
  await tx.demoBatch.update({ where: { id: current.id }, data: { status: 'clearing' } });
  await auditDemo(tx, req, 'demo.clear_requested', current.id);
  return { batchId: current.id, previous: current.status };
}

/** Two loads at once: the second insert meets the one-batch unique index. */
export const isSecondBatch = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const running = (status: string) => status === 'loading' || status === 'clearing';

/** The one batch, locked for the transaction. */
async function currentBatch(tx: Tx): Promise<{ id: string; status: string } | null> {
  const [row] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id"::text AS "id", "status" FROM "demo_batches" ORDER BY "created_at" DESC LIMIT 1 FOR UPDATE`;
  return row ?? null;
}

async function auditDemo(tx: Tx, req: DemoRequest, action: string, batchId: string) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: req.actorId,
      entityType: 'demo_batch',
      entityId: batchId,
      ip: req.ip,
      meta: { reason: req.reason, via: req.via },
    },
  });
}
