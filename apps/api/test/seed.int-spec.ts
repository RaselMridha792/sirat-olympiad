/**
 * The config seed runs on every production deploy, so it must be idempotent and must never overwrite
 * values an admin has changed.
 */
import { Category, PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS, GRADE_LEVELS, RANK_THRESHOLDS, ROUNDS, seedConfig } from '../prisma/seed';
import { testPrisma, truncateAll } from './helpers';

const prisma: PrismaClient = testPrisma();

beforeAll(async () => {
  await truncateAll(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('seedConfig', () => {
  it('inserts all config rows into an empty database', async () => {
    const inserted = await seedConfig(prisma);
    expect(inserted).toEqual({
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
  });

  it('is idempotent: a second run inserts nothing', async () => {
    expect(await seedConfig(prisma)).toEqual({ gradeLevels: 0, settings: 0, rankThresholds: 0, rounds: 0 });
  });

  it('never overwrites values an admin has changed', async () => {
    await prisma.setting.update({ where: { key: 'registration_fee_minor' }, data: { value: 50000 } });
    await prisma.setting.update({ where: { key: 'registration_open' }, data: { value: true } });
    await prisma.rankThreshold.update({ where: { name: 'Silver' }, data: { minPoints: 150 } });
    await prisma.gradeLevel.update({ where: { sortOrder: 1 }, data: { label: 'Class 5 (renamed by admin)' } });

    expect(await seedConfig(prisma)).toEqual({ gradeLevels: 0, settings: 0, rankThresholds: 0, rounds: 0 });

    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_fee_minor' } })).value).toBe(50000);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } })).value).toBe(true);
    expect((await prisma.rankThreshold.findUniqueOrThrow({ where: { name: 'Silver' } })).minPoints).toBe(150);
    expect((await prisma.gradeLevel.findUniqueOrThrow({ where: { sortOrder: 1 } })).label).toBe(
      'Class 5 (renamed by admin)',
    );
    expect(await prisma.gradeLevel.count()).toBe(17); // the renamed level was not re-added as a duplicate
  });
});
