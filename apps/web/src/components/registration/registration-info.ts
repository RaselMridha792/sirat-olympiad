import type { RegistrationInfo } from '@sirat/shared';

/*
 * GET /api/registrations/info for the /register page: open or closed, the fee, and the form's choices. The same for
 * every visitor, so it is cached for 30 s (the API caches 30 s too) and sent without any cookie or client header.
 * Any failure (the API down, a wrong shape) is null: the page then says the form cannot be loaded. Nothing is logged
 * here. The parser is pure (no Next imports), for node --test.
 */

const TIMEOUT_MS = 5000;

const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

export function parseRegistrationInfo(body: unknown): RegistrationInfo | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.open !== 'boolean' || !isTextOrNull(b.opensAt) || !isTextOrNull(b.closesAt))
    return null;
  let fee: RegistrationInfo['fee'] = null;
  if (b.fee !== null) {
    const f = b.fee as Record<string, unknown> | undefined;
    if (!f || !Number.isInteger(f.amountMinor) || (f.amountMinor as number) <= 0) return null;
    if (!isText(f.currency)) return null;
    fee = { amountMinor: f.amountMinor as number, currency: f.currency };
  }
  const grades = b.gradeLevels;
  if (
    !Array.isArray(grades) ||
    !grades.every((g) => typeof g === 'object' && g !== null && isText(g.id) && isText(g.label))
  )
    return null;
  if (!Array.isArray(b.districts) || !b.districts.every(isText)) return null;
  if (!Array.isArray(b.educationTypes) || !b.educationTypes.every(isText)) return null;
  return {
    open: b.open,
    opensAt: b.opensAt,
    closesAt: b.closesAt,
    fee,
    // Only the fields the form uses, one by one.
    gradeLevels: grades.map((g: { id: string; label: string }) => ({ id: g.id, label: g.label })),
    districts: [...b.districts],
    educationTypes: [...b.educationTypes],
  };
}

function baseUrl(): string | null {
  const configured = process.env.API_INTERNAL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? null : 'http://localhost:4000';
}

export async function readRegistrationInfo(): Promise<RegistrationInfo | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/registrations/info`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return parseRegistrationInfo(await res.json());
  } catch {
    return null;
  }
}
