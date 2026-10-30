/** Seeded PRNG (mulberry32) so mock data is identical on every run and every machine. */
export interface Random {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  id(prefix: string): string;
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let counter = 0;
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick() on an empty list');
      return item;
    },
    chance: (probability) => next() < probability,
    id: (prefix) => {
      counter += 1;
      const hex = Math.floor(next() * 0xffffffff)
        .toString(16)
        .padStart(8, '0');
      return `${prefix}-${hex}-${String(counter).padStart(5, '0')}`;
    },
  };
}
