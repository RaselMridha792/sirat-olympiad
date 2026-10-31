import { Prisma } from '@prisma/client';
import { isRetryableDbError } from './db-errors';

const clientVersion = '6.19.0';
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion, meta });
// The shape Prisma 6 gives a model query the database cancelled (seen on Postgres 17).
const modelQuery = (sqlstate: string) =>
  new Prisma.PrismaClientUnknownRequestError(
    `Invalid \`tx.session.updateMany()\` invocation: Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sqlstate}", message: "canceling statement", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion },
  );

describe('isRetryableDbError', () => {
  it('accepts Prisma transaction timeouts and write conflicts', () => {
    expect(isRetryableDbError(known('P2028'))).toBe(true);
    expect(isRetryableDbError(known('P2034'))).toBe(true);
  });

  it('accepts lock and statement timeouts, serialization failures and deadlocks from raw and model queries', () => {
    for (const sqlstate of ['55P03', '57014', '40001', '40P01']) {
      expect(isRetryableDbError(known('P2010', { code: sqlstate }))).toBe(true);
      expect(isRetryableDbError(modelQuery(sqlstate))).toBe(true);
    }
  });

  it('refuses everything else, so real faults still surface', () => {
    expect(isRetryableDbError(known('P2002'))).toBe(false); // unique violation
    expect(isRetryableDbError(known('P2010', { code: '23505' }))).toBe(false);
    expect(isRetryableDbError(modelQuery('23503'))).toBe(false);
    expect(isRetryableDbError(new Error('canceling statement due to lock timeout'))).toBe(false);
    expect(isRetryableDbError(undefined)).toBe(false);
  });
});
