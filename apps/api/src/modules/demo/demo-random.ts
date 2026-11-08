import type { DemoRandom } from './demo.types';

/**
 * mulberry32: a tiny seeded PRNG, so a demo load is reproducible and needs no dependency. Not for anything secret
 * (the demo password comes from crypto.randomBytes).
 */
export function demoRandom(seed: number): DemoRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    int,
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('demoRandom.pick: empty list');
      return items[int(items.length)]!;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    digits: (n) => Array.from({ length: n }, () => String(int(10))).join(''),
  };
}

/** The seed of a batch: its id's first 8 hex digits, so each batch differs and the same batch id gives the same data. */
export const seedOf = (batchId: string): number =>
  parseInt(batchId.replace(/-/g, '').slice(0, 8), 16) >>> 0;
