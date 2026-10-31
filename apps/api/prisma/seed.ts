/**
 * Idempotent CONFIG seed: runtime settings only.
 * Runs in every environment (production included) via the `migrate` service after `prisma migrate deploy`.
 *
 * Rules (safe to run on every deploy; it never overwrites or deletes what an admin changed):
 * - settings: insert each missing KEY (keys are a code contract, so new keys reach existing databases);
 *   existing values are never touched.
 * - Reference data (grade levels, rank thresholds, rounds) is NOT seeded here: it ships as SQL data migrations
 *   (baseline: prisma/migrations/*_reference_data_baseline), so it runs in a fixed order with later data
 *   migrations on every database, fresh or old (A1.1).
 * The fee itself is set by the data migration *_registration_fee_400 (it runs before this seed); the default below
 * only matters for a key that is still missing, and it matches the migration, so both paths agree.
 */
import { Prisma, PrismaClient } from '@prisma/client';

/** Runtime settings. Registration starts CLOSED; an admin opens it (and may set the window) after the checks. */
export const DEFAULT_SETTINGS: Readonly<
  Record<string, Prisma.InputJsonValue | typeof Prisma.JsonNull>
> = {
  registration_open: false,
  registration_fee_minor: 40000, // 400 BDT in paisa (DECISIONS 2026-10-31 "Registration fee", owner)
  registration_opens_at: Prisma.JsonNull, // ISO UTC or null (no lower bound)
  registration_closes_at: Prisma.JsonNull, // ISO UTC or null (no upper bound)
  currency: 'BDT',
  leaderboard_public: false,
  payment_expiry_minutes: 60,
  // Free book (plan 16): an admin sets the real title and uploads the cover before registration opens (RUNBOOK §9).
  book_title: 'Sirat Leadership Olympiad book',
  book_cover_image_id: Prisma.JsonNull, // book_images.id once an admin uploads a cover
  // No global submit grace: exams.grace_seconds (per exam) is the only source (DECISIONS, A1 review).
};

export type SeedResult = { settings: number };

/** Inserts missing settings keys and returns how many were inserted. Existing rows are untouched. */
export async function seedConfig(prisma: PrismaClient): Promise<SeedResult> {
  const settings = await prisma.setting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
    skipDuplicates: true,
  });
  return { settings: settings.count };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const inserted = await seedConfig(prisma);
    console.log(JSON.stringify({ msg: 'config seed done (existing rows untouched)', inserted }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Message only: never dump the error object (it can contain connection strings).
    console.error('config seed failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
