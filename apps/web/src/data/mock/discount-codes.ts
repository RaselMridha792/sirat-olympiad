import type {
  AdminDiscountCode,
  AdminDiscountCodeQuery,
  AdminDiscountCodeUse,
  AdminDiscountCodeUses,
  PageQuery,
} from '@sirat/shared';
import { dammDigit, discountCodeStatus } from '@sirat/shared';
import { paginate } from './paging.ts';

/*
 * Mock discount codes (payments D2): one code in each status, so the admin pages show every badge, and paid uses on
 * the first. Fixed relative to the moment of the call; nothing is stored.
 */

const DAY = 86_400_000;
const FEE = 40000;

function rawCodes(now: number): Omit<AdminDiscountCode, 'status'>[] {
  const at = (days: number) => new Date(now + days * DAY).toISOString();
  const base = {
    note: null,
    ambassador: null,
    locked: false,
    demo: false,
    maxUses: null,
    startsAt: null,
    endsAt: null,
    active: true,
    uses: { paid: 0, live: 0 },
    createdAt: at(-10),
    updatedAt: at(-2),
  };
  return [
    {
      ...base,
      id: '0190f000-0000-7000-8000-00000000dc01',
      code: 'DC-7K2M9QXR',
      kind: 'amount',
      value: 5000,
      maxUses: 100,
      note: 'School partners',
      ambassador: {
        userId: '0190f000-0000-7000-8000-0000000000a1',
        name: 'Nusrat Jahan',
        promoCode: 'SR-4FQ2ZD',
      },
      uses: { paid: 3, live: 1 },
      locked: true,
    },
    {
      ...base,
      id: '0190f000-0000-7000-8000-00000000dc02',
      code: 'EID2026',
      kind: 'percent',
      value: 20,
      endsAt: at(14),
    },
    {
      ...base,
      id: '0190f000-0000-7000-8000-00000000dc03',
      code: 'DC-H3PW5T0B',
      kind: 'amount',
      value: 10000,
      active: false,
    },
    {
      ...base,
      id: '0190f000-0000-7000-8000-00000000dc04',
      code: 'WINTER25',
      kind: 'percent',
      value: 25,
      startsAt: at(-30),
      endsAt: at(-1),
    },
    {
      ...base,
      id: '0190f000-0000-7000-8000-00000000dc05',
      code: 'DC-N8V1C6JE',
      kind: 'amount',
      value: 7500,
      startsAt: at(3),
    },
  ];
}

function codes(now: number): AdminDiscountCode[] {
  return rawCodes(now).map((c) => ({ ...c, status: discountCodeStatus(c, now) }));
}

export function mockDiscountCodes(query: AdminDiscountCodeQuery, now = Date.now()) {
  const q = query.q?.toUpperCase();
  return paginate(
    codes(now)
      .filter((c) => !q || c.code.includes(q))
      .filter((c) => !query.status || c.status === query.status)
      .filter((c) => !query.linked || c.ambassador !== null),
    query,
  );
}

export const mockDiscountCode = (id: string, now = Date.now()): AdminDiscountCode | null =>
  codes(now).find((c) => c.id === id) ?? null;

export function mockDiscountCodeUses(
  id: string,
  query: PageQuery,
  now = Date.now(),
): AdminDiscountCodeUses | null {
  const code = mockDiscountCode(id, now);
  if (!code) return null;
  const names = ['Rahim Uddin', 'Sadia Akter', 'Tanvir Hasan'];
  const uses: AdminDiscountCodeUse[] = Array.from({ length: code.uses.paid }, (_, i) => {
    const body = String(4821093700 + i);
    return {
      paymentId: `0190f000-0000-7000-8000-0000000d${String(i).padStart(4, '0')}`,
      invoiceNumber: `T26111${i}ABCDEFGHJK`,
      userId: `0190f000-0000-7000-8000-0000000b${String(i).padStart(4, '0')}`,
      name: names[i % names.length] ?? null,
      participantId: `ON${body}${dammDigit(body)}`,
      paidAt: new Date(now - (i + 1) * DAY).toISOString(),
      listAmountMinor: FEE,
      discountMinor: code.kind === 'amount' ? code.value : 0,
      amountMinor: FEE - (code.kind === 'amount' ? code.value : 0),
    };
  });
  const page = paginate(uses, query);
  return {
    ...page,
    totals: {
      uses: uses.length,
      discountMinor: uses.reduce((s, u) => s + u.discountMinor, 0),
      collectedMinor: uses.reduce((s, u) => s + u.amountMinor, 0),
    },
  };
}
