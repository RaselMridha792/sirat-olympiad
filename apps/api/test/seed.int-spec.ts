/**
 * The config seed runs on every production deploy, so it must be idempotent, must never overwrite values an
 * admin has changed, and must never re-add rows an admin renamed, moved or removed.
 */
import { Category, PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS, GRADE_LEVELS, RANK_THRESHOLDS, ROUNDS, seedConfig } from '../prisma/seed';
import { testPrisma, truncateAll } from './helpers';

const prisma: PrismaClient = testPrisma();
const NOTHING = { gradeLevels: 0, settings: 0, rankThresholds: 0, rounds: 0 };

beforeEach(async () => {
  await truncateAll(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('seedConfig', () => {
  it('inserts all config rows into an empty database', async () => {
    expect(await seedConfig(prisma)).toEqual({
      gradeLevels: GRADE_LEVELS.length,
      settings: Object.keys(DEFAULT_SETTINGS).length,
      rankThresholds: RANK_THRESHOLDS.length,
      rounds: ROUNDS.length,
    });
    expect(GRADE_LEVELS).toHaveLength(17);

    const byCategory = await prisma.gradeLevel.groupBy({ by: ['category'], _count: { _all: true } });
    const counts = Object.fromEntries(byCategory.map((g) => [g.category, g._count._all]));
    expect(counts).toEqual({ [Category.activist]: 4, [Category.ambassador]: 6, [Category.achiever]: 7 });

    const open = await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } });
    expect(open.value).toBe(false); // registration starts closed
    expect(await prisma.setting.findUnique({ where: { key: 'submit_grace_seconds' } })).toBeNull();
  });

  it('is idempotent: a second run inserts nothing', async () => {
    await seedConfig(prisma);
    expect(await seedConfig(prisma)).toEqual(NOTHING);
  });

  it('never overwrites values an admin has changed', async () => {
    await seedConfig(prisma);
    await prisma.setting.update({ where: { key: 'registration_fee_minor' }, data: { value: 50000 } });
    await prisma.setting.update({ where: { key: 'registration_open' }, data: { value: true } });
    await prisma.rankThreshold.update({ where: { name: 'Silver' }, data: { minPoints: 150 } });
    await prisma.gradeLevel.update({ where: { sortOrder: 1 }, data: { label: 'Class 5 (renamed by admin)' } });

    expect(await seedConfig(prisma)).toEqual(NOTHING);

    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_fee_minor' } })).value).toBe(50000);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } })).value).toBe(true);
    expect((await prisma.rankThreshold.findUniqueOrThrow({ where: { name: 'Silver' } })).minPoints).toBe(150);
    expect((await prisma.gradeLevel.findUniqueOrThrow({ where: { sortOrder: 1 } })).label).toBe(
      'Class 5 (renamed by admin)',
    );
    expect(await prisma.gradeLevel.count()).toBe(17);
  });

  it('does not re-add a rank an admin renamed and moved', async () => {
    await seedConfig(prisma);
    await prisma.rankThreshold.update({ where: { name: 'Gold' }, data: { name: 'Platinum', minPoints: 300 } });

    await seedConfig(prisma);

    expect(await prisma.rankThreshold.findUnique({ where: { name: 'Gold' } })).toBeNull();
    expect(await prisma.rankThreshold.count()).toBe(3);
  });

  it('does not add a second Round 1 after an admin reorders rounds', async () => {
    await seedConfig(prisma);
    await prisma.round.update({ where: { sortOrder: 1 }, data: { sortOrder: 2 } });

    await seedConfig(prisma);

    expect(await prisma.round.count()).toBe(1);
  });

  it('does not re-add a grade level an admin removed', async () => {
    await seedConfig(prisma);
    await prisma.gradeLevel.delete({ where: { sortOrder: 17 } });

    await seedConfig(prisma);

    expect(await prisma.gradeLevel.count()).toBe(16);
  });

  it('adds a settings key the code introduced later to an already-seeded database', async () => {
    await seedConfig(prisma);
    await prisma.setting.delete({ where: { key: 'leaderboard_public' } }); // as if the key were new in this release

    expect(await seedConfig(prisma)).toEqual({ ...NOTHING, settings: 1 });
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'leaderboard_public' } })).value).toBe(false);
  });

  it('two concurrent runs (scale-out deploy) neither fail nor duplicate rows', async () => {
    const results = await Promise.all([seedConfig(prisma), seedConfig(prisma)]);
    const sum = (k: keyof (typeof results)[number]) => results.reduce((n, r) => n + r[k], 0);

    expect(sum('gradeLevels')).toBe(17);
    expect(sum('rankThresholds')).toBe(3);
    expect(sum('rounds')).toBe(1);
    expect(await prisma.gradeLevel.count()).toBe(17);
    expect(await prisma.rankThreshold.count()).toBe(3);
    expect(await prisma.round.count()).toBe(1);
    expect(await prisma.setting.count()).toBe(Object.keys(DEFAULT_SETTINGS).length);
  });
});
