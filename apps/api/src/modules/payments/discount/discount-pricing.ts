import { PaymentStatus, type DiscountCode, type Prisma } from '@prisma/client';
import {
  DISCOUNT_KINDS,
  listPrice,
  priceWithDiscount,
  type DiscountKind,
  type Price,
} from '@sirat/shared';

/*
 * The one price rule for registration (DECISIONS "Discount codes"; payments D1): start, retry and the public quote
 * all come here, so the quote can never promise what the start does not charge. A use is a paid payment with the code,
 * or a checkout with it still in progress (initiated or pending, before its expiry): that is a reserved use, and the
 * start counts it under the code's row lock, so two starts at once never both take the last use.
 */

type Db = Pick<Prisma.TransactionClient, 'discountCode' | 'payment' | 'ambassadorProfile'>;

/** A code a real registration may use now: active, inside its window, not demo data. */
export function usableNow(
  code: Pick<DiscountCode, 'active' | 'startsAt' | 'endsAt' | 'demoBatchId'>,
  now: Date,
): boolean {
  return (
    code.active &&
    code.demoBatchId === null &&
    (code.startsAt === null || code.startsAt <= now) &&
    (code.endsAt === null || now < code.endsAt)
  );
}

/** The code as typed (CITEXT: any case). */
export const findDiscountCode = (db: Db, code: string): Promise<DiscountCode | null> =>
  db.discountCode.findUnique({ where: { code } });

/** Paid uses and reserved ones (checkouts in progress, before their expiry). */
export async function usesOf(
  db: Db,
  codeId: string,
  now: Date,
): Promise<{ paid: number; live: number }> {
  const [paid, live] = await Promise.all([
    db.payment.count({ where: { discountCodeId: codeId, status: PaymentStatus.paid } }),
    db.payment.count({
      where: {
        discountCodeId: codeId,
        status: { in: [PaymentStatus.initiated, PaymentStatus.pending] },
        expiresAt: { gt: now },
      },
    }),
  ]);
  return { paid, live };
}

/** True while another use fits under max_uses (paid + reserved). */
export async function hasRoom(db: Db, code: Pick<DiscountCode, 'id' | 'maxUses'>, now: Date) {
  if (code.maxUses === null) return true;
  const uses = await usesOf(db, code.id, now);
  return uses.paid + uses.live < code.maxUses;
}

/**
 * Inside the start or retry transaction: locks the code's row (so concurrent starts count one after another) and
 * reads it again. Null when it is gone.
 */
export async function lockCode(
  tx: Prisma.TransactionClient,
  codeId: string,
): Promise<DiscountCode | null> {
  await tx.$queryRaw`SELECT "id" FROM "discount_codes" WHERE "id" = ${codeId}::uuid FOR UPDATE`;
  return tx.discountCode.findUnique({ where: { id: codeId } });
}

/** The linked ambassador, when still approved and real: a use also counts as that ambassador's referral. */
export async function linkedReferrer(
  db: Db,
  code: Pick<DiscountCode, 'ambassadorUserId'>,
): Promise<string | null> {
  if (!code.ambassadorUserId) return null;
  const profile = await db.ambassadorProfile.findFirst({
    where: {
      userId: code.ambassadorUserId,
      approvedAt: { not: null },
      user: { demoBatchId: null },
    },
    select: { userId: true },
  });
  return profile?.userId ?? null;
}

/** The column's kind (text with a CHECK) as the shared type; anything else is a broken row, never a price. */
export function asDiscountKind(kind: string): DiscountKind {
  if (!(DISCOUNT_KINDS as readonly string[]).includes(kind))
    throw new Error('discount code kind out of range');
  return kind as DiscountKind;
}

/** The price for this fee with this code (or none). */
export const priceFor = (
  feeMinor: number,
  code: Pick<DiscountCode, 'kind' | 'value'> | null,
): Price =>
  code ? priceWithDiscount(feeMinor, asDiscountKind(code.kind), code.value) : listPrice(feeMinor);
