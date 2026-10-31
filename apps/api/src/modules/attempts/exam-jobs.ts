import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStore } from './attempt-store';
import { timeTakenSeconds } from './exam-time';
import { answersValid, optionCounts, parseLayout } from './layout';
import { type KeyedVersion, scoreAnswers, storedAnswers } from './scoring';

/** Margins after `ends_at + grace` and after `window_end + grace` (a provider, so tests can use 0). */
export const EXAM_JOB_TIMING = Symbol('EXAM_JOB_TIMING');
export interface ExamJobTiming {
  /** The client's last submit can still be on its way: the server waits this long before finalizing. */
  finalizeAfterMs: number;
  /** Results are built this long after the window has closed for everyone and nothing is left unfinished. */
  buildAfterMs: number;
  /** A finalized attempt still unscored this long after its submit lost its scoring job; the sweep scores it. */
  rescoreAfterMs: number;
}
export const DEFAULT_EXAM_JOB_TIMING: ExamJobTiming = {
  finalizeAfterMs: 30_000,
  buildAfterMs: 60_000,
  rescoreAfterMs: 5 * 60_000,
};

const SWEEP_BATCH = 500;

export type BuildOutcome = 'built' | 'not_ready';

/**
 * The exam engine's background work (EXAM-PLAN 3.9, 3.10, 3.12), run by the worker. Every step is idempotent: two
 * workers, a retried job or a repeated sweep never score twice, submit twice or build a broken snapshot. Correct keys
 * are read from Postgres here, never from the cache.
 */
@Injectable()
export class ExamJobs {
  private readonly logger = new Logger(ExamJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: AttemptStore,
    @Inject(EXAM_JOB_TIMING) private readonly timing: ExamJobTiming,
  ) {}

  /** Scores one finalized attempt. Returns false if there is nothing to score (not submitted yet, or already scored). */
  async score(attemptId: string): Promise<boolean> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        layout: true,
        questionCount: true,
        submission: { select: { answers: true } },
      },
    });
    if (!attempt?.submission || (attempt.status !== 'submitted' && attempt.status !== 'expired'))
      return false;
    const layout = parseLayout(attempt.layout);
    const rows = await this.prisma.question.findMany({
      where: { id: { in: layout.q } },
      select: { id: true, options: true, correctKey: true },
    });
    const versions = new Map<string, KeyedVersion>(
      rows.map((r) => [
        r.id,
        { options: r.options as KeyedVersion['options'], correctKey: r.correctKey },
      ]),
    );
    const score = scoreAnswers(
      layout,
      versions,
      storedAnswers(attempt.submission.answers, attempt.questionCount),
    );
    const updated = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: { in: ['submitted', 'expired'] } },
      data: { status: 'scored', score, scoredAt: new Date() },
    });
    return updated.count === 1;
  }

  /**
   * The minute sweep: (1) attempts past `ends_at + grace` with no submit are submitted from their last checkpoint (or
   * empty); (2) finalized attempts still unscored are scored; (3) closed exams with nothing unfinished get results.
   */
  async sweep(): Promise<{ finalized: number; scored: number; built: number }> {
    const finalizeAfterSeconds = this.timing.finalizeAfterMs / 1000;
    // The partial index attempts_in_progress_ends_at_idx serves this (status = 'in_progress' AND ends_at < …).
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "attempts" a JOIN "exams" e ON e."id" = a."exam_id"
      WHERE a."status" = 'in_progress'
        AND a."ends_at" < now() - make_interval(secs => e."grace_seconds" + ${finalizeAfterSeconds}::float8)
      ORDER BY a."ends_at" LIMIT ${SWEEP_BATCH}`;
    let finalized = 0;
    for (const { id } of due) if (await this.finalize(id)) finalized++;

    const unscored = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "attempts"
      WHERE "status" IN ('submitted', 'expired')
        AND ("submitted_at" < now() - make_interval(secs => ${this.timing.rescoreAfterMs / 1000}::float8) OR "id" = ANY(${due.map((d) => d.id)}::uuid[]))
      LIMIT ${SWEEP_BATCH}`;
    let scored = 0;
    for (const { id } of unscored) if (await this.score(id)) scored++;

    const buildAfterSeconds = this.timing.buildAfterMs / 1000;
    const closed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT e."id" FROM "exams" e
      WHERE e."status" = 'published' AND e."results_snapshot_at" IS NULL
        AND e."window_end" < now() - make_interval(secs => e."grace_seconds" + ${buildAfterSeconds}::float8)
        AND NOT EXISTS (
          SELECT 1 FROM "attempts" a
          WHERE a."exam_id" = e."id" AND a."status" IN ('in_progress', 'submitted', 'expired'))
      LIMIT 20`;
    let built = 0;
    for (const { id } of closed) if ((await this.buildResults(id)) === 'built') built++;

    if (finalized || scored || built)
      this.logger.log({ msg: 'exam sweep', finalized, scored, built });
    return { finalized, scored, built };
  }

  /**
   * Owner Q3: no submit by the end of the grace means the server submits the last checkpoint, or an empty sheet.
   * SKIP LOCKED: a late client submit (still inside its grace) or another sweep holding the row wins.
   */
  async finalize(attemptId: string): Promise<boolean> {
    const checkpoint = await this.store.readCheckpoint(attemptId);
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        {
          status: string;
          startedAt: Date;
          endsAt: Date;
          layout: unknown;
          graceSeconds: number;
          due: boolean;
        }[]
      >`
        SELECT a."status"::text AS "status", a."started_at" AS "startedAt", a."ends_at" AS "endsAt", a."layout",
               e."grace_seconds" AS "graceSeconds",
               a."ends_at" + make_interval(secs => e."grace_seconds") < now() AS "due"
        FROM "attempts" a JOIN "exams" e ON e."id" = a."exam_id"
        WHERE a."id" = ${attemptId}::uuid
        FOR UPDATE OF a SKIP LOCKED`;
      if (!row || row.status !== 'in_progress' || !row.due) return false;
      if (await tx.submission.findUnique({ where: { attemptId }, select: { id: true } }))
        return false;

      const layout = parseLayout(row.layout);
      const usable = checkpoint?.answers && answersValid(checkpoint.answers, optionCounts(layout));
      const answers = usable ? checkpoint!.answers! : layout.q.map(() => null);
      await tx.submission.create({
        data: {
          attemptId,
          requestId: `auto.${attemptId}`,
          answers: { v: 1, a: answers },
          endReason: usable ? 'server_checkpoint' : 'server_empty',
          violationCount: checkpoint?.violationCount ?? 0,
          events: (checkpoint?.events ?? []).map((e) => ({ type: e.type, at: e.at })),
        },
      });
      await tx.attempt.update({
        where: { id: attemptId },
        data: {
          status: 'expired',
          submittedAt: new Date(),
          timeTakenSeconds: timeTakenSeconds(row.startedAt, row.endsAt, row.endsAt),
        },
      });
      return true;
    });
  }

  /**
   * One snapshot generation of the exam's results (EXAM-PLAN 3.12; DECISIONS leaderboard query form). Only once the
   * window has closed for everyone and no attempt is unfinished; blocked accounts are left out.
   */
  async buildResults(examId: string): Promise<BuildOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '120s'`);
        const [exam] = await tx.$queryRaw<{ generation: number; ready: boolean }[]>`
          SELECT e."results_generation" AS "generation",
                 e."status" = 'published'
                 AND e."window_end" + make_interval(secs => e."grace_seconds") < now()
                 AND NOT EXISTS (
                   SELECT 1 FROM "attempts" a
                   WHERE a."exam_id" = e."id" AND a."status" IN ('in_progress', 'submitted', 'expired')) AS "ready"
          FROM "exams" e WHERE e."id" = ${examId}::uuid
          FOR UPDATE`;
        if (!exam?.ready) return 'not_ready';
        const generation = exam.generation + 1;
        await tx.$executeRaw`
          INSERT INTO "leaderboard_entries" ("exam_id", "generation", "position", "rank", "user_id", "attempt_id",
                                             "name", "institution", "category", "score", "time_taken_seconds",
                                             "created_at")
          SELECT a."exam_id", ${generation}::int,
                 row_number() OVER (ORDER BY a."score" DESC, a."time_taken_seconds" ASC, a."id"),
                 rank() OVER (ORDER BY a."score" DESC, a."time_taken_seconds" ASC),
                 a."user_id", a."id", u."name", u."institution", u."category", a."score",
                 a."time_taken_seconds", now()
          FROM "attempts" a JOIN "users" u ON u."id" = a."user_id"
          WHERE a."exam_id" = ${examId}::uuid AND a."score" IS NOT NULL AND NOT u."is_blocked"
          ORDER BY a."score" DESC, a."time_taken_seconds" ASC`;
        await tx.$executeRaw`
          UPDATE "exams" SET "results_generation" = ${generation}::int, "results_snapshot_at" = now(),
                             "updated_at" = now()
          WHERE "id" = ${examId}::uuid`;
        return 'built';
      },
      { timeout: 130_000 },
    );
  }
}
