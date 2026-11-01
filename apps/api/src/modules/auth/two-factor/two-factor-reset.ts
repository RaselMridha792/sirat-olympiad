import type { Prisma } from '@prisma/client';
import { endSessionsOf } from '../end-sessions';

/**
 * Takes a user's two-factor login away, in the caller's transaction: the factor (enrolled or pending), every recovery
 * code, and every session (so no session of the user claims a factor that no longer exists). Returns the number of
 * sessions ended. Plain Prisma: used by turning 2FA off, the admin reset and the break-glass CLI, which needs no
 * TOTP_ENCRYPTION_KEY (nothing is decrypted).
 */
export async function removeTwoFactor(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  await tx.userTwoFactor.deleteMany({ where: { userId } });
  return endSessionsOf(tx, userId);
}
