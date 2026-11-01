import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { correctedKeys, databaseNow, effectiveKey } from '../exams/answer-keys';
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
  /** E7b: an answer-key correction whose attempts are still unre-scored this long after it lost its job (or the job
   * failed for good); the sweep re-scores the exam. */
  keyRescoreAfterMs: number;
}
export const DEFAULT_EXAM_JOB_TIMING: ExamJobTiming = {
  finalizeAfterMs: 30_000,
  buildAfterMs: 60_000,
  rescoreAfterMs: 5 * 60_000,
  keyRescoreAfterMs: 2 * 60_000,
};

const SWEEP_BATCH = 500;
/** Attempts re-scored per transaction after an answer-key correction (E7b). */
export const RESCORE_BATCH = 500;

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

  /**
   * Scores one finalized attempt. Returns false if there is nothing to score (not submitted yet, or already scored).
   * One transaction holding the exam row FOR SHARE: an answer-key correction takes it FOR NO KEY UPDATE, so a score is either
   * written before the correction (and the re-scoring job fixes it) or computed with the corrected key (E7b). Nothing
   * on the submit or time-up path updates the exam row, so this never waits behind a student.
   */
  async score(attemptId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.findUnique({
        where: { id: attemptId },
        select: {
          examId: true,
          status: true,
          layout: true,
          questionCount: true,
          submission: { select: { answers: true } },
        },
      });
      if (!attempt?.submission || (attempt.status !== 'submitted' && attempt.status !== 'expired'))
        return false;
      await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${attempt.examId}::uuid FOR SHARE`;
      const scoredAt = await databaseNow(tx);
      const layout = parseLayout(attempt.layout);
      const versions = await keyedVersions(tx, layout.q);
      const score = scoreAnswers(
        layout,
        versions,
        storedAnswers(attempt.submission.answers, attempt.questionCount),
      );
      const updated = await tx.attempt.updateMany({
        where: { id: attemptId, status: { in: ['submitted', 'expired'] } },
        data: { status: 'scored', score, scoredAt },
      });
      return updated.count === 1;
    });
  }

  /**
   * E7b: the rescore-exam job (and the sweep's catch-up). Re-scores the attempts scored before the exam's newest
   * answer-key correction, in batches; each batch is one transaction that also writes its counts in an audit row
   * (`answer_key.rescored`, meta { correctionId, attempts, changed }), so the totals the admin's results panel shows
   * (summed over those rows) stay right across a retry, a run that failed half-way, or the job and the sweep running at
   * once. A failure throws, so the job is retried and one that failed for good shows in ops-check's failed_jobs.
   * `correctionId` is the job's, for the log; the batches always work for the newest correction.
   */
  async rescoreAfterCorrection(
    examId: string,
    correctionId: string | null,
  ): Promise<{ attempts: number; changed: number }> {
    const result = await this.rescore(examId);
    this.logger.log({
      msg: 'exam rescored after an answer-key correction',
      examId,
      correctionId,
      ...result,
    });
    return result;
  }

  /**
   * E7b: re-scores, with the keys in effect now, every scored attempt of the exam scored before its newest correction.
   * Each batch holds the exam row FOR SHARE (a new correction waits, and a batch after it reads the new key) and takes
   * its attempts FOR UPDATE SKIP LOCKED (two runs never take the same row). A re-scored attempt gets a scored_at after
   * the correction, so it is never taken again and the results status counts it as done. Idempotent: the score is
   * recomputed from the submission and the layout. Returns how many attempts this run re-scored and how many changed.
   */
  async rescore(examId: string): Promise<{ attempts: number; changed: number }> {
    let attempts = 0;
    let changed = 0;
    for (let first = true; ; first = false) {
      const batch = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${examId}::uuid FOR SHARE`;
          const newest = await tx.answerKeyCorrection.findFirst({
            where: { examId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, createdAt: true },
          });
          if (!newest) return null;
          const ids = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "attempts"
            WHERE "exam_id" = ${examId}::uuid AND "status" = 'scored' AND "scored_at" < ${newest.createdAt}
            ORDER BY "id" LIMIT ${RESCORE_BATCH} FOR UPDATE SKIP LOCKED`;
          // A first run with nothing to do still records its (zero) counts, so the panel shows "0 changed".
          if (ids.length === 0 && !first) return null;
          const rows = await tx.attempt.findMany({
            where: { id: { in: ids.map((r) => r.id) } },
            select: {
              id: true,
              score: true,
              layout: true,
              questionCount: true,
              submission: { select: { answers: true } },
            },
          });
          const layouts = rows.map((r) => parseLayout(r.layout));
          const versions = await keyedVersions(tx, [...new Set(layouts.flatMap((l) => l.q))]);
          // The same clock as the correction's created_at, and never at or before it (or the row would stay waiting).
          const scoredAt = new Date(
            Math.max((await databaseNow(tx)).getTime(), newest.createdAt.getTime() + 1),
          );
          let batchChanged = 0;
          for (const [i, row] of rows.entries()) {
            const score = scoreAnswers(
              layouts[i]!,
              versions,
              storedAnswers(row.submission?.answers ?? null, row.questionCount),
            );
            if (score !== row.score) batchChanged++;
            await tx.attempt.update({ where: { id: row.id }, data: { score, scoredAt } });
          }
          await tx.auditLog.create({
            data: {
              action: 'answer_key.rescored',
              actorId: null,
              entityType: 'exam',
              entityId: examId,
              meta: { correctionId: newest.id, attempts: rows.length, changed: batchChanged },
            },
          });
          return { count: rows.length, changed: batchChanged };
        },
        { timeout: 60_000 },
      );
      if (!batch) break;
      attempts += batch.count;
      changed += batch.changed;
      if (batch.count === 0) break;
    }
    return { attempts, changed };
  }

  /**
   * The minute sweep: (1) attempts past `ends_at + grace` with no submit are submitted from their last checkpoint (or
   * empty); (2) finalized attempts still unscored are scored; (3) closed exams with nothing unfinished get results.
   * Each item is tried on its own: one that throws (a lock or statement timeout under load, a bad row) never stops the
   * others, so results are never held back behind it. The run then fails, so the worker logs it and L11's failed_jobs
   * check alerts, and the next sweep (a minute later) tries that item again. A finalize that loses its row to
   * SKIP LOCKED is not an error: the next sweep takes the row again.
   */
  async sweep(): Promise<{ finalized: number; scored: number; built: number }> {
    const finalizeAfterSeconds = this.timing.finalizeAfterMs / 1000;
    // The partial index attempts_in_progress_ends_at_idx serves this (status = 'in_progress' AND ends_at < …).
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "attempts" a JOIN "exams" e ON e."id" = a."exam_id"
      WHERE a."status" = 'in_progress'
        AND a."ends_at" < now() - make_interval(secs => e."grace_seconds" + ${finalizeAfterSeconds}::float8)
      ORDER BY a."ends_at" LIMIT ${SWEEP_BATCH}`;
    let failed = 0;
    const each = async <T>(step: string, id: string, run: () => Promise<T>): Promise<T | null> => {
      try {
        return await run();
      } catch (err) {
        failed++;
        this.logger.warn({ msg: 'exam sweep item failed', step, id, ...errorLogFields(err) });
        return null;
      }
    };
    let finalized = 0;
    for (const { id } of due) if (await each('finalize', id, () => this.finalize(id))) finalized++;

    const unscored = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "attempts"
      WHERE "status" IN ('submitted', 'expired')
        AND ("submitted_at" < now() - make_interval(secs => ${this.timing.rescoreAfterMs / 1000}::float8) OR "id" = ANY(${due.map((d) => d.id)}::uuid[]))
      LIMIT ${SWEEP_BATCH}`;
    let scored = 0;
    for (const { id } of unscored) if (await each('score', id, () => this.score(id))) scored++;

    // E7b: an exam whose newest answer-key correction is keyRescoreAfterMs old and still has attempts scored before it
    // lost its re-scoring job (or the job failed): re-score it here. Idempotent, so a job still running is harmless.
    const stale = await this.prisma.$queryRaw<{ exam_id: string; correction_id: string }[]>`
      SELECT c."exam_id", c."id" AS "correction_id"
      FROM (SELECT DISTINCT ON ("exam_id") "exam_id", "id", "created_at" FROM "answer_key_corrections"
            ORDER BY "exam_id", "created_at" DESC, "id" DESC) c
      WHERE c."created_at" < now() - make_interval(secs => ${this.timing.keyRescoreAfterMs / 1000}::float8)
        AND EXISTS (SELECT 1 FROM "attempts" a
                    WHERE a."exam_id" = c."exam_id" AND a."status" = 'scored' AND a."scored_at" < c."created_at")
      LIMIT 5`;
    let rescored = 0;
    for (const { exam_id, correction_id } of stale)
      if (await each('rescore', exam_id, () => this.rescoreAfterCorrection(exam_id, correction_id)))
        rescored++;

    const buildAfterSeconds = this.timing.buildAfterMs / 1000;
    const closed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT e."id" FROM "exams" e
      WHERE e."status" = 'published' AND e."results_snapshot_at" IS NULL
        AND e."window_end" < now() - make_interval(secs => e."grace_seconds" + ${buildAfterSeconds}::float8)
        AND NOT EXISTS (
          SELECT 1 FROM "attempts" a
          WHERE a."exam_id" = e."id" AND a."status" IN ('in_progress', 'submitted', 'expired'))
        AND NOT EXISTS (
          -- E7b: never a snapshot of scores taken before the newest answer-key correction.
          SELECT 1 FROM "attempts" a
          JOIN (SELECT "exam_id", max("created_at") AS "at" FROM "answer_key_corrections" GROUP BY "exam_id") c
            ON c."exam_id" = a."exam_id"
          WHERE a."exam_id" = e."id" AND a."status" = 'scored' AND a."scored_at" < c."at")
      LIMIT 20`;
    let built = 0;
    for (const { id } of closed)
      if ((await each('build', id, () => this.buildResults(id))) === 'built') built++;

    if (finalized || scored || rescored || built || failed)
      this.logger.log({ msg: 'exam sweep', finalized, scored, rescored, built, failed });
    if (failed)
      throw new Error(
        `exam sweep: ${failed} item(s) failed; the others went on, and the next sweep tries again`,
      );
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
   * window has closed for everyone, no attempt is unfinished and none waits for its re-scoring after the newest
   * answer-key correction (E7b); blocked accounts are left out. The exam row is held FOR UPDATE, so no correction and
   * no re-scoring batch lands while the snapshot is taken.
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
                   WHERE a."exam_id" = e."id" AND a."status" IN ('in_progress', 'submitted', 'expired'))
                 AND NOT EXISTS (
                   SELECT 1 FROM "attempts" a
                   JOIN (SELECT max("created_at") AS "at" FROM "answer_key_corrections"
                         WHERE "exam_id" = ${examId}::uuid) c ON true
                   WHERE a."exam_id" = e."id" AND a."status" = 'scored' AND a."scored_at" < c."at") AS "ready"
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

/** The question versions of a layout, each with the key in effect (its newest correction's, else its own; E7b). */
async function keyedVersions(
  db: Prisma.TransactionClient,
  questionIds: string[],
): Promise<Map<string, KeyedVersion>> {
  const rows = await db.question.findMany({
    where: { id: { in: questionIds } },
    select: { id: true, options: true, correctKey: true },
  });
  const corrected = await correctedKeys(db, questionIds);
  return new Map<string, KeyedVersion>(
    rows.map((r) => [
      r.id,
      { options: r.options as KeyedVersion['options'], correctKey: effectiveKey(corrected, r) },
    ]),
  );
}
