/**
 * The registration fee data migration (*_registration_fee_400, DECISIONS 2026-10-31 "Registration fee", owner):
 * missing key -> 40000 with an audit row; an admin's value -> untouched, no audit row; a fresh deploy (migrate, then
 * seed) ends at 40000. The placeholder-0 case needs a database from before the settings CHECK: see
 * payments-migration.int-spec.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { seedConfig } from '../prisma/seed';
import { testPrisma, truncateAll } from './helpers';

const prisma: PrismaClient = testPrisma();
const KEY = 'registration_fee_minor';
const ACTION = 'settings.registration_fee_set';

/** The migration's SQL exactly as `prisma migrate deploy` runs it (comment lines dropped; one statement). */
function feeMigrationSql(): string {
  const migrations = join(__dirname, '..', 'prisma', 'migrations');
  const dir = readdirSync(migrations).find((d) => d.endsWith('_registration_fee_400'));
  if (!dir) throw new Error('registration_fee_400 migration not found');
  return readFileSync(join(migrations, dir, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/;$/, '');
}
const auditRows = () => prisma.auditLog.count({ where: { action: ACTION } });

beforeEach(async () => {
  await truncateAll(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('registration fee migration', () => {
  it('inserts 40000 with an audit row when the key is missing', async () => {
    const before = await auditRows();
    await prisma.$executeRawUnsafe(feeMigrationSql());
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(40000);
    expect(await auditRows()).toBe(before + 1);
  });

  it('leaves a value an admin chose untouched, without an audit row', async () => {
    await prisma.setting.create({ data: { key: KEY, value: 50000 } });
    const before = await auditRows();
    await prisma.$executeRawUnsafe(feeMigrationSql());
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(50000);
    expect(await auditRows()).toBe(before);
  });

  it('the seed after the migration keeps 40000 and adds the other keys', async () => {
    await prisma.$executeRawUnsafe(feeMigrationSql());
    await seedConfig(prisma);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(40000);
    const opens = await prisma.setting.findUniqueOrThrow({
      where: { key: 'registration_opens_at' },
    });
    expect(opens.value).toBeNull();
    const open = await prisma.setting.findUniqueOrThrow({ where: { key: 'registration_open' } });
    expect(open.value).toBe(false);
  });
});
