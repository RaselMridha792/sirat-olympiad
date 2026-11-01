import { Prisma } from '@prisma/client';

/** Lock timeout, statement timeout, serialization failure, deadlock: the transaction rolled back, try again. */
const RETRYABLE_SQLSTATE = /\b(?:55P03|57014|40001|40P01)\b/;

/**
 * True when the database refused a transaction for a passing reason: it rolled back, nothing changed, and the same
 * work can simply be tried again. Prisma reports these three ways: its own transaction errors (P2028 timeout or
 * maxWait, P2034 write conflict or deadlock), raw queries as P2010 with the SQLSTATE in `meta.code`, and model
 * queries as an unknown request error with the SQLSTATE only in the message.
 */
export function isRetryableDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2028' || error.code === 'P2034') return true;
    const sqlstate = (error.meta as { code?: unknown } | undefined)?.code;
    return typeof sqlstate === 'string' && RETRYABLE_SQLSTATE.test(sqlstate);
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    RETRYABLE_SQLSTATE.test(error.message)
  );
}

/**
 * The database is too busy right now, and nothing was applied: a passing refusal (isRetryableDbError: the transaction
 * rolled back), or P2024 (no connection could be taken from the pool, so nothing ran). The API answers 503
 * SERVICE_BUSY and the same request can be sent again. Connection-lost errors (P1001, P1017) are NOT in this set: they
 * can hit during COMMIT with an unknown outcome, so a retry could apply a POST twice; they stay 500.
 */
export function isBusyDbError(error: unknown): boolean {
  return (
    isRetryableDbError(error) ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2024')
  );
}
