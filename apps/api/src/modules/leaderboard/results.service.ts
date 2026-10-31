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
  AttemptStatus,
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
import { ExamCache } from '../exams/exam-cache';
import type { AdminAttemptsQueryDto, LeaderboardQueryDto } from './dto/results.dto';

const refuse = (...codes: ExamResultsRefusal[]) => new ConflictException(codes);
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
          correctKey: q.correctKey,
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

  /** Rank, name, institution; only from a published snapshot (owner Q5). Pages are cached per generation. */
  async leaderboard(query: LeaderboardQueryDto): Promise<ExamLeaderboard> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const exam = query.exam
      ? await this.prisma.exam.findUnique({ where: { id: query.exam }, select: examInfoSelect })
      : await this.prisma.exam.findFirst({
          where: { resultsPublishedAt: { not: null } },
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
    return {
      examId,
      windowClosed,
      counts,
      snapshotAt: exam.resultsSnapshotAt?.toISOString() ?? null,
      generation: exam.resultsGeneration,
      publishedAt: exam.resultsPublishedAt?.toISOString() ?? null,
      canBuild: exam.status === 'published' && windowClosed && unfinished === 0,
      canPublish:
        exam.status === 'published' &&
        windowClosed &&
        exam.resultsSnapshotAt !== null &&
        !exam.resultsPublishedAt,
    };
  }

  /** Queues a (re)build; the worker builds it (202). */
  async build(examId: string, actor: Actor): Promise<{ queued: boolean }> {
    await this.prisma.$transaction((tx) => assertAdmin(tx, actor.id));
    const state = await this.status(examId);
    if (!state.windowClosed) throw refuse('window_open');
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
