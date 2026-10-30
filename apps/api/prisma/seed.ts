/**
 * Idempotent CONFIG seed: grade levels, settings, rank thresholds, rounds.
 * Runs in every environment (production included) via the `migrate` service after `prisma migrate deploy`.
 *
 * Rules (safe to run on every deploy; it never overwrites or re-adds what an admin changed):
 * - settings: insert each missing KEY (keys are a code contract, so new keys reach existing databases);
 *   existing values are never touched.
 * - grade_levels, rank_thresholds, rounds: seeded ONCE, only while the table is empty. Later changes to these
 *   tables ship as SQL data migrations, so an admin rename, reorder or removal is never undone by a deploy.
 *   Each table is checked separately, so a partially failed run heals on the next one; skipDuplicates keeps two
 *   concurrent runners from failing on each other.
 * Values marked PLACEHOLDER await client confirmation (docs/OPEN-QUESTIONS.md #2, #3, #13).
 */
import { Category, Prisma, PrismaClient, RoundType } from '@prisma/client';

/** The 17 grade levels of the registration wizard, in display order. Category bands are a PLACEHOLDER (OQ #3). */
export const GRADE_LEVELS: ReadonlyArray<{ label: string; category: Category }> = [
  { label: 'Class 5 / PYP 5 / Taisir', category: Category.activist },
  { label: 'Class 6 / MYP 1 / Mizan', category: Category.activist },
  { label: 'Class 7 / MYP 2 / Nahbemir', category: Category.activist },
  { label: 'Class 8 / MYP 3 / Hidayatunnah', category: Category.activist },
  { label: 'Class 9 / MYP 4 / Kafiya & Bekaya', category: Category.ambassador },
  { label: 'Class 10 / MYP 5', category: Category.ambassador },
  { label: 'SSC / O Level / Dakhil Candidate', category: Category.ambassador },
  { label: 'Class 11 / DP 1 / Jalalayn', category: Category.ambassador },
  { label: 'Class 12 / DP 2', category: Category.ambassador },
  { label: 'HSC / A Level / Alim Candidate', category: Category.ambassador },
  { label: 'University Admission Candidate / Musannif', category: Category.achiever },
  { label: 'University 1st Year / Diploma 1st Year / Fazil / Mishkat', category: Category.achiever },
  { label: 'University 2nd Year / Diploma 2nd Year', category: Category.achiever },
  { label: 'University 3rd Year / Diploma 3rd Year', category: Category.achiever },
  { label: 'University 4th Year / Diploma 4th Year', category: Category.achiever },
  { label: 'University 5th Year & Intern / Kamil / Dawrah', category: Category.achiever },
  { label: 'Postgraduate (Masters) and Above', category: Category.achiever },
];

/** Runtime settings. Registration starts CLOSED so the placeholder fee can never be charged. */
export const DEFAULT_SETTINGS: Readonly<Record<string, Prisma.InputJsonValue>> = {
  registration_open: false,
  registration_fee_minor: 0, // PLACEHOLDER (OQ #2): admin sets the real fee before opening registration
  currency: 'BDT',
  leaderboard_public: false,
  payment_expiry_minutes: 60,
  // No global submit grace: exams.grace_seconds (per exam) is the only source (DECISIONS, A1 review).
};

/** PLACEHOLDER thresholds (OQ #13); admins edit them in the DB. */
export const RANK_THRESHOLDS: ReadonlyArray<{ name: string; minPoints: number }> = [
  { name: 'Bronze', minPoints: 0 },
  { name: 'Silver', minPoints: 100 },
  { name: 'Gold', minPoints: 250 },
];

export const ROUNDS: ReadonlyArray<{ name: string; sortOrder: number; type: RoundType }> = [
  { name: 'Round 1', sortOrder: 1, type: RoundType.quiz },
];

export type SeedResult = Record<'gradeLevels' | 'settings' | 'rankThresholds' | 'rounds', number>;

/** Inserts missing config rows and returns how many were inserted per table. Existing rows are untouched. */
export async function seedConfig(prisma: PrismaClient): Promise<SeedResult> {
  const settings = await prisma.setting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
    skipDuplicates: true,
  });
  const gradeLevels = await seedIfEmpty(
    () => prisma.gradeLevel.count(),
    () =>
      prisma.gradeLevel.createMany({
        data: GRADE_LEVELS.map((g, i) => ({ ...g, sortOrder: i + 1 })),
        skipDuplicates: true,
      }),
  );
  const rankThresholds = await seedIfEmpty(
    () => prisma.rankThreshold.count(),
    () => prisma.rankThreshold.createMany({ data: [...RANK_THRESHOLDS], skipDuplicates: true }),
  );
  const rounds = await seedIfEmpty(
    () => prisma.round.count(),
    () => prisma.round.createMany({ data: [...ROUNDS], skipDuplicates: true }),
  );
  return { gradeLevels, settings: settings.count, rankThresholds, rounds };
}

async function seedIfEmpty(count: () => Promise<number>, insert: () => Promise<{ count: number }>): Promise<number> {
  if ((await count()) > 0) return 0;
  return (await insert()).count;
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
