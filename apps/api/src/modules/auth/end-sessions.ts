import type { Prisma } from '@prisma/client';

/**
 * Ends every active session of a user (logout everywhere): returns how many were still active. Plain Prisma, so the
 * break-glass CLI (src/cli/admin-2fa-reset.ts) ends sessions exactly as the API does. The access tokens already out
 * stay valid until they expire (JWT_ACCESS_TTL_SECONDS); refreshing them fails from now on.
 */
export async function endSessionsOf(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
