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
