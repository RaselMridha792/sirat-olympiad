/**
 * Config data on every deploy:
 * - the settings seed runs on every deploy: idempotent, never overwrites admin values, new keys still arrive;
 * - reference data (grade levels, rank thresholds, Round 1) ships as the baseline data migration: a fresh database
 *   built exactly like a deploy (migrate deploy, then seed) gets it, and an existing database keeps admin edits.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Category, PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS, seedConfig } from '../prisma/seed';
import { applyReferenceData, testPrisma, truncateAll } from './helpers';

const prisma: PrismaClient = testPrisma();
const SETTINGS_COUNT = Object.keys(DEFAULT_SETTINGS).length;

beforeEach(async () => {
  await truncateAll(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('settings seed (runs on every deploy)', () => {
  it('inserts every settings key into an empty database, registration closed', async () => {
    expect(await seedConfig(prisma)).toEqual({ settings: SETTINGS_COUNT });
    const open = await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } });
    expect(open.value).toBe(false);
    expect(await prisma.setting.findUnique({ where: { key: 'submit_grace_seconds' } })).toBeNull();
  });

  it('is idempotent: a second run inserts nothing', async () => {
    await seedConfig(prisma);
    expect(await seedConfig(prisma)).toEqual({ settings: 0 });
  });

  it('never overwrites values an admin has changed', async () => {
    await seedConfig(prisma);
    await prisma.setting.update({
      where: { key: 'registration_fee_minor' },
      data: { value: 50000 },
    });
    await prisma.setting.update({ where: { key: 'registration_open' }, data: { value: true } });

    expect(await seedConfig(prisma)).toEqual({ settings: 0 });

    const fee = await prisma.setting.findUniqueOrThrow({
      where: { key: 'registration_fee_minor' },
    });
    const open = await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } });
    expect(fee.value).toBe(50000);
    expect(open.value).toBe(true);
  });

  it('adds a settings key the code introduced later to an already-seeded database', async () => {
    await seedConfig(prisma);
    await prisma.setting.delete({ where: { key: 'leaderboard_public' } }); // as if the key were new in this release

    expect(await seedConfig(prisma)).toEqual({ settings: 1 });
    const added = await prisma.setting.findUniqueOrThrow({ where: { key: 'leaderboard_public' } });
    expect(added.value).toBe(false);
  });

  it('two concurrent runs (scale-out deploy) neither fail nor duplicate rows', async () => {
    const [a, b] = await Promise.all([seedConfig(prisma), seedConfig(prisma)]);
    expect(a.settings + b.settings).toBe(SETTINGS_COUNT);
    expect(await prisma.setting.count()).toBe(SETTINGS_COUNT);
  });
});

describe('reference data baseline migration', () => {
  it('fills empty tables: 17 grade levels (4/6/7), 3 rank thresholds, Round 1', async () => {
    await applyReferenceData(prisma);

    const byCategory = await prisma.gradeLevel.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(byCategory.map((g) => [g.category, g._count._all]));
    expect(counts).toEqual({
      [Category.activist]: 4,
      [Category.ambassador]: 6,
      [Category.achiever]: 7,
    });
    const first = await prisma.gradeLevel.findUniqueOrThrow({ where: { sortOrder: 1 } });
    expect(first.label).toBe('Class 5 / PYP 5 / Taisir');
    const ranks = await prisma.rankThreshold.findMany({ orderBy: { minPoints: 'asc' } });
    expect(ranks.map((r) => [r.name, r.minPoints])).toEqual([
      ['Bronze', 0],
      ['Silver', 100],
      ['Gold', 250],
    ]);
    expect(
      await prisma.round.findMany({ select: { name: true, sortOrder: true, type: true } }),
    ).toEqual([{ name: 'Round 1', sortOrder: 1, type: 'quiz' }]);
  });

  it('changes nothing on a database that already has rows, so admin edits survive', async () => {
    await applyReferenceData(prisma);
    await prisma.rankThreshold.update({
      where: { name: 'Gold' },
      data: { name: 'Platinum', minPoints: 300 },
    });
    await prisma.round.update({ where: { sortOrder: 1 }, data: { sortOrder: 2 } });
    await prisma.gradeLevel.delete({ where: { sortOrder: 17 } });

    await applyReferenceData(prisma); // as on a database seeded before this migration existed

    expect(await prisma.rankThreshold.findUnique({ where: { name: 'Gold' } })).toBeNull();
    expect(await prisma.rankThreshold.count()).toBe(3);
    expect(await prisma.round.count()).toBe(1);
    expect(await prisma.gradeLevel.count()).toBe(16);
  });

  it('a fresh database built like a deploy (migrate deploy, then seed) has the reference data and settings', async () => {
    const base = new URL(process.env.TEST_DATABASE_URL as string);
    const name = `sirat_fresh_${randomUUID().slice(0, 8)}_test`;
    const freshUrl = new URL(base.toString());
    freshUrl.pathname = `/${name}`;
    const adminUrl = new URL(base.toString());
    adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    let fresh: PrismaClient | undefined;
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // name is generated above: safe identifier
      execFileSync('prisma', ['migrate', 'deploy'], {
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: freshUrl.toString(), DIRECT_URL: freshUrl.toString() },
        shell: process.platform === 'win32',
      });
      fresh = new PrismaClient({ datasourceUrl: freshUrl.toString() });
      await seedConfig(fresh);

      expect(await fresh.gradeLevel.count()).toBe(17);
      expect(await fresh.rankThreshold.count()).toBe(3);
      expect(await fresh.round.count()).toBe(1);
      expect(await fresh.setting.count()).toBe(SETTINGS_COUNT);
    } finally {
      await fresh?.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  }, 120_000);
});
