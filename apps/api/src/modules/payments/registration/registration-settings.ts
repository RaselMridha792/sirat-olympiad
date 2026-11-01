import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The settings registration depends on (plan 3.1, 3.2). Read from the database at every start (the fee snapshot must
 * be the current fee); only the public info endpoint is cached.
 */
export type RegistrationSettings = {
  open: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  /** Null when the stored fee is not a valid fee: then no payment can start (plan 3.2). */
  feeMinor: number | null;
  currency: string;
  expiryMinutes: number;
};

const KEYS = [
  'registration_open',
  'registration_opens_at',
  'registration_closes_at',
  'registration_fee_minor',
  'currency',
  'payment_expiry_minutes',
] as const;

/** A valid fee: a whole-taka integer in paisa between 10 and 10,000 BDT (the bounds catch an extra zero). */
export function validFee(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value % 100 === 0 &&
    value >= 1_000 &&
    value <= 1_000_000
    ? value
    : null;
}

const date = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function parseRegistrationSettings(
  rows: { key: string; value: Prisma.JsonValue }[],
): RegistrationSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const expiry = get('payment_expiry_minutes');
  return {
    open: get('registration_open') === true,
    opensAt: date(get('registration_opens_at')),
    closesAt: date(get('registration_closes_at')),
    feeMinor: validFee(get('registration_fee_minor')),
    currency: typeof get('currency') === 'string' ? (get('currency') as string) : '',
    expiryMinutes:
      typeof expiry === 'number' && Number.isInteger(expiry) && expiry >= 5 && expiry <= 1_440
        ? expiry
        : 10, // the seed's default: PayStation's link lifetime (S12)
  };
}

export async function readRegistrationSettings(
  prisma: Pick<PrismaClient, 'setting'>,
): Promise<RegistrationSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [...KEYS] } } });
  return parseRegistrationSettings(rows);
}

/** Open: the switch is on and now is inside the window (server clock). Checked at start and retry only. */
export function isRegistrationOpen(s: RegistrationSettings, now: Date): boolean {
  return s.open && (!s.opensAt || now >= s.opensAt) && (!s.closesAt || now < s.closesAt);
}
