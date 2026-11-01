import type { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_POINTS_PER_REFERRAL, pointsPerReferral, ReferralPoints } from './referral-points';

/** A Prisma stand-in that records the sweep's INSERT (its SQL text and values). */
function fakeDb(opts: { setting?: unknown; anyAwarded: boolean }) {
  const inserts: { sql: string; values: unknown[] }[] = [];
  const db = {
    setting: {
      findUnique: async () => (opts.setting === undefined ? null : { value: opts.setting }),
    },
    $queryRaw: async () => (opts.anyAwarded ? [{ '?column?': 1 }] : []),
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      inserts.push({ sql: strings.join('?'), values });
      return 0;
    },
  };
  return { db: db as unknown as PrismaService, inserts };
}

describe('ReferralPoints', () => {
  it('looks at every registration on the first run ever, then at the last 2 days', async () => {
    const first = fakeDb({ setting: 10, anyAwarded: false });
    expect(await new ReferralPoints(first.db).run('recent')).toEqual({ mode: 'full', awarded: 0 });
    expect(JSON.stringify(first.inserts[0]!.values)).not.toContain('created_at');

    const later = fakeDb({ setting: 10, anyAwarded: true });
    const now = new Date('2026-11-05T06:00:00Z');
    expect(await new ReferralPoints(later.db).run('recent', now)).toEqual({
      mode: 'recent',
      awarded: 0,
    });
    // The window is the bound value of the created_at condition: exactly 2 days back.
    const since = JSON.stringify(later.inserts[0]!.values);
    expect(since).toContain('created_at');
    expect(since).toContain('2026-11-03T06:00:00.000Z');
  });

  it('writes nothing while the setting is 0', async () => {
    const zero = fakeDb({ setting: 0, anyAwarded: true });
    expect(await new ReferralPoints(zero.db).run('full')).toEqual({ mode: 'full', awarded: 0 });
    expect(zero.inserts).toHaveLength(0);
  });

  it('uses the default when the setting is missing or not a whole number of 0 or more', async () => {
    for (const setting of [undefined, '10', 2.5, -3, null, { n: 5 }])
      expect(await pointsPerReferral(fakeDb({ setting, anyAwarded: true }).db)).toBe(
        DEFAULT_POINTS_PER_REFERRAL,
      );
    expect(await pointsPerReferral(fakeDb({ setting: 25, anyAwarded: true }).db)).toBe(25);
  });
});
