/**
 * Canary values for `?mock=leak` (dev only). They are distinctive enough that finding one in a
 * rendered page can only mean a page rendered or serialized a field it must not show.
 * scripts/check-pages.mjs keeps its own copy of these values: change both together.
 */
export const LEAK_CANARY = {
  text: 'LEAK_CANARY_7Q9Z',
  score: 98765431,
  seconds: 87654319,
  email: 'leak.canary@example.invalid',
} as const;

const EXTRA: Record<string, unknown> = {
  score: LEAK_CANARY.score,
  timeTakenSeconds: LEAK_CANARY.seconds,
  email: LEAK_CANARY.email,
  phone: LEAK_CANARY.text,
  correctKey: LEAK_CANARY.text,
  passwordHash: LEAK_CANARY.text,
};

/** Adds the canary fields to every object in the value (recursively), never overwriting a real field. */
export function withLeakCanaries<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => withLeakCanaries(item)) as T;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) copy[key] = withLeakCanaries(inner);
    for (const [key, canary] of Object.entries(EXTRA)) if (!(key in copy)) copy[key] = canary;
    return copy as T;
  }
  return value;
}
