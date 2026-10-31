/**
 * Public reads for the static public pages (no cookie, no request headers, so the pages stay static). The entry
 * page shows the fee and whether registration is open from payments' `GET /api/registrations/info`, revalidated
 * at most every 60 s. Any failure (the API down, a build without API_INTERNAL_URL, a wrong shape) is null: the page
 * then shows no fee and keeps its buttons. Errors are never logged here (no URL, no body).
 */
export interface PublicRegistrationInfo {
  open: boolean;
  fee: { amountMinor: number; currency: string } | null;
}

const TIMEOUT_MS = 3000;

function baseUrl(): string | null {
  const configured = process.env.API_INTERNAL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? null : 'http://localhost:4000';
}

/** The fields the page uses, or null when the body has another shape. Pure, for node --test. */
export function parseRegistrationInfo(body: unknown): PublicRegistrationInfo | null {
  if (typeof body !== 'object' || body === null) return null;
  const { open, fee } = body as { open?: unknown; fee?: unknown };
  if (typeof open !== 'boolean') return null;
  if (fee === null) return { open, fee: null };
  if (typeof fee !== 'object' || fee === undefined) return null;
  const { amountMinor, currency } = fee as { amountMinor?: unknown; currency?: unknown };
  if (!Number.isInteger(amountMinor) || (amountMinor as number) <= 0) return null;
  if (typeof currency !== 'string') return null;
  return { open, fee: { amountMinor: amountMinor as number, currency } };
}

export async function getRegistrationInfo(): Promise<PublicRegistrationInfo | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/registrations/info`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return parseRegistrationInfo(await res.json());
  } catch {
    return null;
  }
}
