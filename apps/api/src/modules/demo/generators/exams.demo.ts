import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AnswerList } from '@sirat/shared';
import { drawLayout, type LayoutV1, type QuestionVersion } from '../../attempts/layout';
import { correctPosition, type KeyedVersion, scoreAnswers } from '../../attempts/scoring';
import { DEMO_QUESTIONS } from '../demo-questions';
import type { DemoContext, DemoGenerator } from '../demo.types';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** Exam titles start with this; the root marker is demo_batch_id, never the title. */
export const DEMO_EXAM_PREFIX = 'DEMO · ';
/** Of the students and ambassadors, this share sat Round 1. */
const ROUND1_SHARE = 0.9;

/**
 * Two demo exams for everyone (category NULL), 30 questions each:
 *  - "DEMO · Practice": open now for 30 days and without attempts, so a demo student can try the exam room;
 *  - "DEMO · Round 1": closed nine days ago and linked to Round 1, with about 90 % of the demo students and ambassadors
 *    scored. Their layouts come from drawLayout and their scores from scoreAnswers, as a real start and the worker make
 *    them, so the review and the leaderboard agree. The results snapshot and its publication follow the load
 *    (ExamJobs.buildResults needs the committed attempts): see DemoJobs.
 */
export const examsDemoGenerator: DemoGenerator = {
  area: 'exams',
  dependsOn: ['users'],
  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('exams');
    const round1 = await ctx.tx.round.findFirst({ where: { sortOrder: 1 }, select: { id: true } });

    const practice = await insertExam(ctx, {
      title: `${DEMO_EXAM_PREFIX}Practice`,
      windowStart: new Date(ctx.now.getTime() - DAY),
      windowEnd: new Date(ctx.now.getTime() + 30 * DAY),
      roundId: null,
    });
    const r1 = await insertExam(ctx, {
      title: `${DEMO_EXAM_PREFIX}Round 1`,
      windowStart: new Date(ctx.now.getTime() - 10 * DAY),
      windowEnd: new Date(ctx.now.getTime() - 9 * DAY),
      roundId: round1?.id ?? null,
    });
    ctx.exams.practice = practice.id;
    ctx.exams.round1 = r1.id;

    await ctx.progress('attempts');
    const sitters = [...ctx.users.students, ...ctx.users.ambassadors].filter(() =>
      ctx.rng.chance(ROUND1_SHARE),
    );
    await insertScoredAttempts(ctx, r1, sitters);
  },
};

interface InsertedExam {
  id: string;
  questions: number;
  windowStart: Date;
  windowEnd: Date;
  contentVersion: number;
  versions: Map<string, QuestionVersion & KeyedVersion>;
}

async function insertExam(
  ctx: DemoContext,
  e: { title: string; windowStart: Date; windowEnd: Date; roundId: string | null },
): Promise<InsertedExam> {
  const id = randomUUID();
  await ctx.tx.exam.create({
    data: {
      id,
      title: e.title,
      category: null,
      roundId: e.roundId,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      durationMinutes: 30,
      questionsPerAttempt: DEMO_QUESTIONS.length,
      graceSeconds: 30,
      randomDraw: false,
      status: 'published',
      publishedAt: new Date(e.windowStart.getTime() - 2 * DAY),
      demoBatchId: ctx.batchId,
    },
  });
  const rows = DEMO_QUESTIONS.map((q, i) => ({
    id: randomUUID(),
    examId: id,
    lineageId: randomUUID(),
    version: 1,
    position: i + 1,
    text: q.text,
    options: q.options.map((text, k) => ({ key: 'ABCD'[k]!, text })),
    correctKey: q.correct,
    explanation: q.explanation,
    keepOptionOrder: false,
  }));
  await ctx.tx.question.createMany({ data: rows });
  await ctx.register('exams', [id]);
  await ctx.register(
    'questions',
    rows.map((r) => r.id),
  );
  // Each question insert raised content_version (questions_bump_exam_content_version): attempts carry the final one.
  const { contentVersion } = await ctx.tx.exam.findUniqueOrThrow({
    where: { id },
    select: { contentVersion: true },
  });
  return {
    id,
    questions: rows.length,
    windowStart: e.windowStart,
    windowEnd: e.windowEnd,
    contentVersion,
    versions: new Map(
      rows.map((r) => [
        r.id,
        { text: r.text, options: r.options, keepOptionOrder: false, correctKey: r.correctKey },
      ]),
    ),
  };
}

/**
 * One scored attempt per sitter. Inserted as in_progress (the only state attempts_guard takes on insert), then moved
 * along the legal path in two statements: submitted, then scored, with each row's own times and score.
 */
async function insertScoredAttempts(
  ctx: DemoContext,
  exam: InsertedExam,
  sitters: readonly { id: string }[],
): Promise<void> {
  const pool = [...exam.versions.keys()];
  const windowMs = exam.windowEnd.getTime() - exam.windowStart.getTime() - 31 * MINUTE;
  const rows = sitters.map((s) => {
    const layout: LayoutV1 = drawLayout(pool, pool.length, false, exam.versions, (n) =>
      ctx.rng.int(n),
    );
    const skill = 0.35 + ctx.rng.int(61) / 100; // 0.35..0.95: a spread of scores
    const answers: AnswerList = layout.q.map((qid, i) => {
      if (ctx.rng.chance(0.04)) return null;
      const right = correctPosition(layout, i, exam.versions.get(qid)!);
      if (ctx.rng.chance(skill)) return right;
      const wrong = (right + 1 + ctx.rng.int(layout.o[i]!.length - 1)) % layout.o[i]!.length;
      return wrong;
    });
    const startedAt = new Date(exam.windowStart.getTime() + ctx.rng.int(windowMs));
    const timeTaken = 5 * 60 + ctx.rng.int(25 * 60); // 5..30 minutes
    const timeUp = timeTaken >= 29 * 60;
    return {
      id: randomUUID(),
      userId: s.id,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * MINUTE),
      submittedAt: new Date(startedAt.getTime() + timeTaken * 1000),
      timeTaken: timeUp ? 30 * 60 : timeTaken,
      layout,
      answers,
      score: scoreAnswers(layout, exam.versions, answers),
      endReason: timeUp ? ('time_up' as const) : ('submitted' as const),
      violations: ctx.rng.chance(0.15) ? 1 + ctx.rng.int(3) : 0,
    };
  });
  if (rows.length === 0) return;

  await ctx.tx.attempt.createMany({
    data: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      examId: exam.id,
      startedAt: r.startedAt,
      endsAt: r.endsAt,
      layout: r.layout as unknown as Prisma.InputJsonValue,
      questionCount: r.layout.q.length,
      contentVersion: exam.contentVersion,
    })),
  });
  await ctx.tx.submission.createMany({
    data: rows.map((r) => ({
      id: randomUUID(),
      attemptId: r.id,
      requestId: `demo.${r.id}`,
      answers: { v: 1, a: r.answers },
      endReason: r.endReason,
      violationCount: r.violations,
      events: Array.from({ length: r.violations }, (_, k) => ({ type: 'leave', at: 60 + k * 120 })),
      createdAt: r.submittedAt,
    })),
  });
  const values = (pick: (r: (typeof rows)[number]) => Prisma.Sql) =>
    Prisma.join(rows.map((r) => Prisma.sql`(${r.id}::uuid, ${pick(r)})`));
  await ctx.tx.$executeRaw`
    UPDATE "attempts" a SET "status" = 'submitted', "submitted_at" = v.at, "time_taken_seconds" = v.tt
    FROM (VALUES ${values((r) => Prisma.sql`${r.submittedAt}::timestamptz, ${r.timeTaken}::int`)}) AS v(id, at, tt)
    WHERE a."id" = v.id`;
  await ctx.tx.$executeRaw`
    UPDATE "attempts" a SET "status" = 'scored', "score" = v.score, "scored_at" = v.at
    FROM (VALUES ${values((r) => Prisma.sql`${r.score}::int, ${new Date(r.submittedAt.getTime() + 2000)}::timestamptz`)}) AS v(id, score, at)
    WHERE a."id" = v.id`;
  await ctx.register(
    'attempts',
    rows.map((r) => r.id),
  );
  const submissions = await ctx.tx.submission.findMany({
    where: { attemptId: { in: rows.map((r) => r.id) } },
    select: { id: true },
  });
  await ctx.register(
    'submissions',
    submissions.map((s) => s.id),
  );
}
