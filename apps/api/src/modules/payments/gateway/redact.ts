import type { GatewayRaw } from './payment-gateway';

/**
 * Makes a gateway answer safe to store in payment_events (plan 4.2, D6): no merchant credentials or tokens, the
 * payer's phone masked to its last 3 digits, at most 16 KB. Pure; never throws.
 */
export const MAX_RAW_BYTES = 16_000; // payment_events_payload_size_check allows 16384 bytes of JSON text
const DROP = /merchant|password|secret|token|api[_-]?key|authorization/i;
const PHONE = /phone|mobile|msisdn/i;

function maskPhone(value: unknown): unknown {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const digits = String(value).replace(/\D/g, '');
  return digits.length > 3 ? `***${digits.slice(-3)}` : '***';
}

function clean(value: unknown, depth: number): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP.test(key)) continue;
      out[key] = PHONE.test(key) ? maskPhone(v) : clean(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  return value;
}

export function redactGatewayBody(body: unknown): GatewayRaw {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body.slice(0, 500);
  const cleaned = clean(body, 0);
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return null;
  const size = Buffer.byteLength(JSON.stringify(cleaned), 'utf8');
  return size > MAX_RAW_BYTES
    ? { truncated: true, bytes: size }
    : (cleaned as Record<string, unknown>);
}
