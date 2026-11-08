import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminAttemptDetail,
  AdminAttemptRow,
  AdminExamLeaderboard,
  AnswerKeyCorrectionView,
  AttemptStatus,
  ExamAdminRefusal,
  ExamEvent,
  ExamLeaderboard,
  ExamLeaderboardExam,
  ExamResultsRefusal,
  ExamResultsStatus,
  Paginated,
  ReviewView,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import type { AuthUser } from '../auth/access-token.service';
import { AttemptStore } from '../attempts/attempt-store';
import { ExamQueue } from '../attempts/exam-queue';
import { parseLayout } from '../attempts/layout';
import { correctPosition, type KeyedVersion, storedAnswers } from '../attempts/scoring';
import {
  type Actor,
  assertAdmin,
  assertFresh,
  audit,
  lockExam,
} from '../exams/admin-exams.service';
import { correctedKeys, databaseNow, effectiveKey } from '../exams/answer-keys';
import { ExamCache } from '../exams/exam-cache';
import type {
  AdminAttemptsQueryDto,
  KeyCorrectionDto,
  LeaderboardQueryDto,
} from './dto/results.dto';

const refuse = (...codes: ExamResultsRefusal[]) => new ConflictException(codes);
const refuseCorrection = (...codes: ExamAdminRefusal[]) => new ConflictException(codes);
const DEFAULT_PAGE_SIZE = 20;
const PAGE_CACHE_TTL_S = 3600;
const REDIS_TIMEOUT_MS = 300;

const examInfoSelect = {
  id: true,
  title: true,
  category: true,
  status: true,
  windowEnd: true,
  graceSeconds: true,
  resultsPublishedAt: true,
  resultsSnapshotAt: true,
  resultsGeneration: true,
  updatedAt: true,
} satisfies Prisma.ExamSelect;
type ExamInfo = Prisma.ExamGetPayload<{ select: typeof examInfoSelect }>;

const info = (e: ExamInfo): ExamLeaderboardExam => ({
  id: e.id,
  title: e.title,
  category: e.category,
});
const closedFor = (e: ExamInfo, now = new Date()) =>
  now.getTime() > e.windowEnd.getTime() + e.graceSeconds * 1000;

/**
 * Results (EXAM-PLAN 3.12; owner Q5): the admin's view and controls of an exam's results, the student leaderboard and
 * review once published, and the admin's list of attempts with their violations (owner Q4). Students never see a
 * score, a time or an email of anyone else; their own score and the correct answers only after publishing.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ExamCache,
    private readonly queue: ExamQueue,
    private readonly store: AttemptStore,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  // ───────────── Students ─────────────

  async review(user: AuthUser, attemptId: string): Promise<ReviewView> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        userId: true,
        examId: true,
        layout: true,
        questionCount: true,
        score: true,
        timeTakenSeconds: true,
        submission: { select: { answers: true, endReason: true } },
        exam: { select: { title: true, resultsPublishedAt: true, resultsGeneration: true } },
      },
    });
    if (!attempt || attempt.userId !== user.id) throw new NotFoundException('Attempt not found');
    if (!attempt.exam.resultsPublishedAt) throw new ForbiddenException(['results_not_published']);
    if (!attempt.submission || attempt.score === null)
      throw new NotFoundException('Result not found');

    const layout = parseLayout(attempt.layout);
    const rows = await this.prisma.question.findMany({
      where: { id: { in: layout.q } },
      select: { id: true, text: true, options: true, correctKey: true, explanation: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    // E7b: the key in effect (a correction made before the results were published), never the frozen row's alone.
    const corrected = await correctedKeys(this.prisma, layout.q);
    const answers = storedAnswers(attempt.submission.answers, attempt.questionCount);
    const entry = await this.prisma.leaderboardEntry.findFirst({
      where: { examId: attempt.examId, generation: attempt.exam.resultsGeneration, attemptId },
      select: { rank: true },
    });
    return {
      attemptId,
      examId: attempt.examId,
      title: attempt.exam.title,
      endReason: attempt.submission.endReason,
      score: attempt.score,
      questionCount: attempt.questionCount,
      rank: entry?.rank ?? null,
      timeTakenSeconds: attempt.timeTakenSeconds,
      questions: layout.q.map((id, i) => {
        const q = byId.get(id)!;
        const version: KeyedVersion = {
          options: q.options as KeyedVersion['options'],
          correctKey: effectiveKey(corrected, q),
        };
        return {
          text: q.text,
          options: layout.o[i]!.map((k) => version.options[k]!.text),
          chosen: answers[i] ?? null,
          correct: correctPosition(layout, i, version),
          explanation: q.explanation,
        };
      }),
    };
  }

  /**
   * Rank, name, institution; only from a published snapshot (owner Q5). Pages are cached per generation. Demo data
   * never mixes with real data (DECISIONS 2026-11-08 "Demo data"): a demo account sees only demo exams' boards and
   * everyone else only real ones (the other side's exam: the same 404 as an unknown one).
   */
  async leaderboard(query: LeaderboardQueryDto, viewerId: string): Promise<ExamLeaderboard> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const viewer = await this.prisma.user.findUnique({
      where: { id: viewerId },
      select: { demoBatchId: true },
    });
    const side: Prisma.ExamWhereInput = viewer?.demoBatchId
      ? { demoBatchId: { not: null } }
      : { demoBatchId: null };
    const exam = query.exam
      ? await this.prisma.exam.findFirst({
          where: { id: query.exam, ...side },
          select: examInfoSelect,
        })
      : await this.prisma.exam.findFirst({
          where: { resultsPublishedAt: { not: null }, ...side },
          orderBy: { resultsPublishedAt: 'desc' },
          select: examInfoSelect,
        });
    if (query.exam && (!exam || exam.status === 'draft'))
      throw new NotFoundException('Exam not found');
    const empty = { items: [], page, pageSize, total: 0, snapshotAt: null };
    if (!exam) return { ...empty, exam: null, status: 'unpublished' };
    if (!exam.resultsPublishedAt) return { ...empty, exam: info(exam), status: 'unpublished' };

    const key = `exam:lb:${exam.id}:${exam.resultsGeneration}:${page}:${pageSize}`;
    if (!query.q) {
      const cached = await withTimeout(this.redis.get(key), REDIS_TIMEOUT_MS).catch(() => null);
      if (cached) return JSON.parse(cached) as ExamLeaderboard;
    }
    const where = this.snapshotWhere(exam, query.q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.leaderboardEntry.count({ where }),
      this.prisma.leaderboardEntry.findMany({
        where,
        orderBy: { position: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { rank: true, name: true, institution: true },
      }),
    ]);
    const view: ExamLeaderboard = {
      exam: info(exam),
      status: 'published',
      snapshotAt: exam.resultsSnapshotAt?.toISOString() ?? null,
      items: rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        institution: r.institution,
        entryStatus: null,
      })),
      page,
      pageSize,
      total,
    };
    if (!query.q)
      await withTimeout(
        this.redis.set(key, JSON.stringify(view), 'EX', PAGE_CACHE_TTL_S),
        REDIS_TIMEOUT_MS,
      ).catch(() => undefined);
    return view;
  }

  // ───────────── Admins (and managers for the leaderboard) ─────────────

  async adminLeaderboard(query: LeaderboardQueryDto): Promise<AdminExamLeaderboard> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const exam = query.exam
      ? await this.prisma.exam.findUnique({ where: { id: query.exam }, select: examInfoSelect })
      : await this.prisma.exam.findFirst({
          where: { resultsSnapshotAt: { not: null } },
          orderBy: { resultsSnapshotAt: 'desc' },
          select: examInfoSelect,
        });
    if (query.exam && !exam) throw new NotFoundException('Exam not found');
    const base = { page, pageSize, isPublic: false, snapshotAt: null, generation: 0 };
    if (!exam || exam.resultsGeneration === 0)
      return { ...base, exam: exam && info(exam), items: [], total: 0 };
    const where = this.snapshotWhere(exam, query.q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.leaderboardEntry.count({ where }),
      this.prisma.leaderboardEntry.findMany({
        where,
        orderBy: { position: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          rank: true,
          name: true,
          institution: true,
          category: true,
          score: true,
          timeTakenSeconds: true,
          userId: true,
          user: { select: { email: true } },
        },
      }),
    ]);
    return {
      exam: info(exam),
      isPublic: exam.resultsPublishedAt !== null,
      snapshotAt: exam.resultsSnapshotAt?.toISOString() ?? null,
      generation: exam.resultsGeneration,
      items: rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        institution: r.institution,
        entryStatus: null,
        email: r.user.email,
        category: r.category,
        userId: r.userId,
        score: r.score,
        timeTakenSeconds: r.timeTakenSeconds,
      })),
      page,
      pageSize,
      total,
    };
  }

  async status(examId: string): Promise<ExamResultsStatus> {
    const exam = await this.exam(examId);
    const groups = await this.prisma.attempt.groupBy({
      by: ['status'],
      where: { examId },
      _count: { _all: true },
    });
    const counts: Record<AttemptStatus, number> = {
      in_progress: 0,
      submitted: 0,
      expired: 0,
      scored: 0,
    };
    for (const g of groups) counts[g.status] = g._count._all;
    const windowClosed = closedFor(exam);
    const unfinished = counts.in_progress + counts.submitted + counts.expired;
    const correction = await this.keyCorrectionState(examId);
    const snapshotStale =
      correction.at !== null &&
      exam.resultsSnapshotAt !== null &&
      exam.resultsSnapshotAt.getTime() < correction.at.getTime();
    return {
      examId,
      windowClosed,
      counts,
      snapshotAt: exam.resultsSnapshotAt?.toISOString() ?? null,
      generation: exam.resultsGeneration,
      publishedAt: exam.resultsPublishedAt?.toISOString() ?? null,
      canBuild:
        exam.status === 'published' && windowClosed && unfinished === 0 && correction.pending === 0,
      canPublish:
        exam.status === 'published' &&
        windowClosed &&
        exam.resultsSnapshotAt !== null &&
        !snapshotStale &&
        !exam.resultsPublishedAt,
      keyCorrectedAt: correction.at?.toISOString() ?? null,
      rescorePending: correction.pending,
      snapshotStale,
      lastCorrection: correction.last,
    };
  }

  /**
   * E7b: the newest correction, the scored attempts not yet re-scored after it, and, once none is left, how many its
   * re-scoring went through and how many scores changed.
   */
  private async keyCorrectionState(examId: string): Promise<{
    at: Date | null;
    pending: number;
    last: ExamResultsStatus['lastCorrection'];
  }> {
    const newest = await this.prisma.answerKeyCorrection.findFirst({
      where: { examId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        fromKey: true,
        toKey: true,
        question: { select: { position: true } },
      },
    });
    if (!newest) return { at: null, pending: 0, last: null };
    const pending = await this.prisma.attempt.count({
      where: { examId, status: 'scored', scoredAt: { lt: newest.createdAt } },
    });
    // The re-scoring batches' counts for this correction (one audit row per batch; see ExamJobs.rescore).
    const batches = await this.prisma.auditLog.findMany({
      where: {
        action: 'answer_key.rescored',
        entityType: 'exam',
        entityId: examId,
        meta: { path: ['correctionId'], equals: newest.id },
      },
      select: { meta: true },
    });
    let attempts = 0;
    let changed = 0;
    for (const b of batches) {
      const meta = b.meta as { attempts?: number; changed?: number } | null;
      attempts += meta?.attempts ?? 0;
      changed += meta?.changed ?? 0;
    }
    const done = pending === 0 && batches.length > 0;
    return {
      at: newest.createdAt,
      pending,
      last: {
        position: newest.question.position,
        fromKey: newest.fromKey,
        toKey: newest.toKey,
        attempts: done ? attempts : null,
        changed: done ? changed : null,
      },
    };
  }

  /**
   * E7b: corrects a published question's key. The question row stays as it was (frozen once published); the
   * correction is a new append-only row, and its key is the one in effect from now on. Refused while results are
   * published (unpublish first), so live results never change underneath. Under the exam row's lock (FOR NO KEY
   * UPDATE): a scoring holding it FOR SHARE finishes first, and every later one reads the new key. Not FOR UPDATE:
   * that would also stop every exam start (the attempt's foreign key takes FOR KEY SHARE) for as long as the
   * correction runs; FOR NO KEY UPDATE leaves starts alone. The created_at is the
   * database's clock after the lock (as every scored_at is), so an attempt scored before the correction always counts
   * as waiting for its re-scoring, and a snapshot taken before it is stale.
   */
  async correctKey(
    examId: string,
    questionId: string,
    dto: KeyCorrectionDto,
    actor: Actor,
  ): Promise<AnswerKeyCorrectionView> {
    const created = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${examId}::uuid FOR NO KEY UPDATE`;
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException('Exam not found');
      assertFresh(exam.updatedAt, dto.expectedUpdatedAt);
      if (exam.status === 'draft') throw refuseCorrection('exam_draft');
      if (exam.status === 'archived') throw refuseCorrection('exam_archived');
      if (exam.resultsPublishedAt) throw refuseCorrection('results_published');
      const question = await tx.question.findUnique({ where: { id: questionId } });
      if (!question || question.examId !== examId)
        throw new NotFoundException(['question_not_in_exam']);
      const options = question.options as Array<{ key: string }>;
      if (!options.some((o) => o.key === dto.toKey)) throw refuseCorrection('key_unknown');
      const current = effectiveKey(await correctedKeys(tx, [questionId]), question);
      if (current === dto.toKey) throw refuseCorrection('same_key');
      const createdAt = await databaseNow(tx);
      const correction = await tx.answerKeyCorrection.create({
        data: {
          examId,
          questionId,
          fromKey: current,
          toKey: dto.toKey,
          reason: dto.reason,
          createdById: actor.id,
          createdAt,
        },
        include: { createdBy: { select: { name: true } } },
      });
      await audit(tx, actor, 'answer_key.corrected', examId, {
        correctionId: correction.id,
        questionId,
        lineageId: question.lineageId,
        from: current,
        to: dto.toKey,
        reason: dto.reason,
      });
      // A second admin working from the same view is refused (stale), not silently corrected twice.
      await tx.exam.update({ where: { id: examId }, data: { updatedAt: createdAt } });
      return { correction, position: question.position };
    });
    // A lost job is caught up by the minute sweep (the status shows the attempts still waiting).
    await this.queue.rescore(examId, created.correction.id);
    await this.cache.invalidateExam(examId);
    const c = created.correction;
    return {
      id: c.id,
      questionId: c.questionId,
      position: created.position,
      fromKey: c.fromKey,
      toKey: c.toKey,
      reason: c.reason,
      createdAt: c.createdAt.toISOString(),
      createdByName: c.createdBy.name,
    };
  }

  /** Queues a (re)build; the worker builds it (202). */
  async build(examId: string, actor: Actor): Promise<{ queued: boolean }> {
    await this.prisma.$transaction((tx) => assertAdmin(tx, actor.id));
    const state = await this.status(examId);
    if (!state.windowClosed) throw refuse('window_open');
    if (state.rescorePending > 0) throw refuse('rescore_pending');
    if (!state.canBuild) throw refuse('attempts_unfinished');
    const queued = await this.queue.build(examId);
    await this.prisma.$transaction((tx) =>
      audit(tx, actor, 'results.build_requested', examId, { queued, generation: state.generation }),
    );
    return { queued };
  }

  async publish(
    examId: string,
    expectedUpdatedAt: string,
    actor: Actor,
  ): Promise<ExamResultsStatus> {
    await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, examId);
      assertFresh(exam.updatedAt, expectedUpdatedAt);
      if (exam.resultsPublishedAt) throw refuse('results_published');
      if (!exam.resultsSnapshotAt) throw refuse('no_snapshot');
      if (!closedFor({ ...exam })) throw refuse('window_open');
      // E7b: never scores from before the newest answer-key correction.
      const newest = await tx.answerKeyCorrection.findFirst({
        where: { examId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (newest && exam.resultsSnapshotAt.getTime() < newest.createdAt.getTime())
        throw refuse('snapshot_stale');
      // The CHECK exams_results_after_window_check refuses it too if the window had not closed for everyone.
      await tx.exam.update({ where: { id: examId }, data: { resultsPublishedAt: new Date() } });
      await audit(tx, actor, 'results.published', examId, { generation: exam.resultsGeneration });
    });
    await this.cache.invalidateExam(examId);
    return this.status(examId);
  }

  async unpublish(
    examId: string,
    expectedUpdatedAt: string,
    actor: Actor,
  ): Promise<ExamResultsStatus> {
    await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, examId);
      assertFresh(exam.updatedAt, expectedUpdatedAt);
      if (!exam.resultsPublishedAt) return;
      await tx.exam.update({ where: { id: examId }, data: { resultsPublishedAt: null } });
      await audit(tx, actor, 'results.unpublished', examId, { generation: exam.resultsGeneration });
    });
    await this.cache.invalidateExam(examId);
    return this.status(examId);
  }

  async attempts(
    examId: string,
    query: AdminAttemptsQueryDto,
  ): Promise<Paginated<AdminAttemptRow>> {
    await this.exam(examId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.AttemptWhereInput = {
      examId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.endReason || query.minViolations !== undefined
        ? {
            submission: {
              ...(query.endReason ? { endReason: query.endReason } : {}),
              ...(query.minViolations !== undefined
                ? { violationCount: { gte: query.minViolations } }
                : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            user: {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.attempt.count({ where }),
      this.prisma.attempt.findMany({
        where,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: attemptRowSelect,
      }),
    ]);
    return { items: rows.map(toAttemptRow), page, pageSize, total };
  }

  async attempt(examId: string, attemptId: string): Promise<AdminAttemptDetail> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        ...attemptRowSelect,
        examId: true,
        submission: { select: { ...submissionSelect, events: true } },
      },
    });
    if (!row || row.examId !== examId) throw new NotFoundException('Attempt not found');
    const events = row.submission
      ? ((row.submission.events as ExamEvent[] | null) ?? [])
      : ((await this.store.readCheckpoint(attemptId))?.events ?? []);
    return { ...toAttemptRow(row), events };
  }

  private snapshotWhere(exam: ExamInfo, q?: string): Prisma.LeaderboardEntryWhereInput {
    return {
      examId: exam.id,
      generation: exam.resultsGeneration,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { institution: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private async exam(examId: string): Promise<ExamInfo> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: examInfoSelect,
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }
}

const submissionSelect = { endReason: true, violationCount: true } as const;
const attemptRowSelect = {
  id: true,
  userId: true,
  status: true,
  startedAt: true,
  endsAt: true,
  submittedAt: true,
  timeTakenSeconds: true,
  score: true,
  user: { select: { name: true, email: true } },
  submission: { select: submissionSelect },
} satisfies Prisma.AttemptSelect;
type AttemptRowData = Prisma.AttemptGetPayload<{ select: typeof attemptRowSelect }>;

function toAttemptRow(a: AttemptRowData): AdminAttemptRow {
  return {
    attemptId: a.id,
    userId: a.userId,
    name: a.user.name,
    email: a.user.email,
    status: a.status,
    endReason: a.submission?.endReason ?? null,
    violationCount: a.submission?.violationCount ?? null,
    startedAt: a.startedAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    timeTakenSeconds: a.timeTakenSeconds,
    score: a.score,
  };
}
