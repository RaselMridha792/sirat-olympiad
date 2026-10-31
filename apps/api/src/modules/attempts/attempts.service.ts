import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EXAM_VIOLATION_EVENTS,
  EXAM_VIOLATION_WARNINGS,
  type AttemptView,
  type CheckpointResult,
  type ExamEvent,
  type ExamStudentRefusal,
  type SubmissionReceipt,
  type SubmitResult,
} from '@sirat/shared';
import { uuidv7 } from '../../common/uuidv7';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../auth/access-token.service';
import { type ExamConfig, ExamCache } from '../exams/exam-cache';
import { hasPaidRegistration, studentAccount, visibleTo } from '../exams/student-access';
import { type AttemptMeta, AttemptStore, type CheckpointOutcome } from './attempt-store';
import { ExamQueue } from './exam-queue';
import type { CheckpointDto, SubmitDto } from './dto/attempt.dto';
import { attemptPhase, remainingSeconds, timeTakenSeconds, withinGrace } from './exam-time';
import {
  answersValid,
  drawLayout,
  type LayoutV1,
  optionCounts,
  parseLayout,
  renderQuestions,
} from './layout';

const refuse = (...codes: ExamStudentRefusal[]) => new ConflictException(codes);
const invalid = (...codes: ExamStudentRefusal[]) => new BadRequestException(codes);

const countViolations = (events: readonly ExamEvent[]): number =>
  events.filter((e) => EXAM_VIOLATION_EVENTS.includes(e.type)).length;

const attemptInclude = {
  submission: { select: { id: true, createdAt: true, endReason: true, violationCount: true } },
} satisfies Prisma.AttemptInclude;
type AttemptWithSubmission = Prisma.AttemptGetPayload<{ include: typeof attemptInclude }>;

export type CheckpointReply = CheckpointResult & { retryAfterMs?: number };

/**
 * The exam engine's student side (EXAM-PLAN section 3): start or resume with a server-drawn layout and server times,
 * checkpoints in Redis only, and one idempotent final submit. Correct keys, explanations and scores never pass
 * through here.
 */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ExamCache,
    private readonly store: AttemptStore,
    private readonly queue: ExamQueue,
  ) {}

  /** POST /exams/:id/attempts. `created` false = the student already had this attempt (resume, any phase). */
  async start(user: AuthUser, examId: string): Promise<{ created: boolean; view: AttemptView }> {
    const student = await studentAccount(this.prisma, user.id);
    let config = await this.cache.config(examId);
    if (!visibleTo(config, student.category)) throw new NotFoundException('Exam not found');

    const existing = await this.findAttempt(user.id, examId);
    if (existing) return { created: false, view: await this.view(existing, config) };
    if (!student.emailVerifiedAt) throw new ForbiddenException(['email_unverified']);
    if (!(await hasPaidRegistration(this.prisma, user.id)))
      throw new ForbiddenException(['registration_required']);

    for (let tries = 0; tries < 2; tries++) {
      const now = new Date();
      if (now.getTime() < new Date(config.windowStart).getTime()) throw refuse('not_open_yet');
      if (now.getTime() >= new Date(config.windowEnd).getTime()) throw refuse('window_closed');

      const pool = await this.cache.pool(examId, config.contentVersion);
      const versions = await this.cache.versions(pool.ids);
      const layout = drawLayout(pool.ids, config.questionsPerAttempt, config.randomDraw, versions);
      const id = uuidv7();
      // One statement on the database's clock; no lock on the exam row. It only inserts while the exam is published,
      // the window is open and the pool is still the one the layout was drawn from.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "attempts" ("id", "user_id", "exam_id", "started_at", "ends_at", "status", "layout",
                                "question_count", "content_version", "created_at", "updated_at")
        SELECT ${id}::uuid, ${user.id}::uuid, e."id", now(),
               LEAST(now() + make_interval(mins => e."duration_minutes"), e."window_end"),
               'in_progress'::"AttemptStatus", ${JSON.stringify(layout)}::jsonb, ${layout.q.length}::int,
               e."content_version", now(), now()
        FROM "exams" e
        WHERE e."id" = ${examId}::uuid AND e."status" = 'published'
          AND now() >= e."window_start" AND now() < e."window_end"
          AND e."content_version" = ${pool.contentVersion}::int
        ON CONFLICT ("user_id", "exam_id") DO NOTHING
        RETURNING "id"`;
      const attempt = await this.findAttempt(user.id, examId);
      if (attempt) return { created: rows.length === 1, view: await this.view(attempt, config) };

      // Nothing inserted: the exam changed under us. Re-read it once (an admin saved a question, or it closed).
      await this.cache.invalidateExam(examId);
      const fresh = await this.cache.config(examId);
      if (!visibleTo(fresh, student.category)) throw new NotFoundException('Exam not found');
      config = fresh;
    }
    throw new ServiceUnavailableException('The exam is being updated. Please try again.');
  }

  /** GET /attempts/me?exam=: the same attempt after a reload or on another device. */
  async resume(user: AuthUser, examId: string): Promise<AttemptView> {
    await studentAccount(this.prisma, user.id);
    const attempt = await this.findAttempt(user.id, examId);
    const config = attempt && (await this.cache.config(examId));
    if (!attempt || !config) throw new NotFoundException('Attempt not found');
    return this.view(attempt, config);
  }

  /** PUT /attempts/:id/checkpoint: Redis only, never the database (RULEBOOK 7.1). */
  async checkpoint(
    user: AuthUser,
    attemptId: string,
    dto: CheckpointDto,
  ): Promise<CheckpointReply> {
    const meta = await this.metaFor(attemptId);
    if (!meta || meta.userId !== user.id) throw new NotFoundException('Attempt not found');
    if (meta.submitted) throw refuse('already_submitted');
    const now = new Date();
    if (!withinGrace(new Date(meta.endsAt), meta.graceSeconds, now)) throw refuse('time_over');
    if (!answersValid(dto.answers, meta.optionCounts)) throw invalid('answers_invalid');

    let outcome: CheckpointOutcome;
    try {
      outcome = await this.store.saveCheckpoint(
        meta,
        {
          seq: dto.seq,
          answers: dto.answers,
          violationCount: Math.max(dto.violationCount, countViolations(dto.events)),
          events: dto.events,
        },
        now.getTime(),
      );
    } catch {
      throw new ServiceUnavailableException(['checkpoint_unavailable']);
    }
    return {
      savedSeq: outcome.savedSeq,
      violationCount: outcome.violationCount,
      remainingSeconds: remainingSeconds(new Date(meta.endsAt), now),
      serverNow: now.toISOString(),
      ...(outcome.kind === 'throttled' ? { retryAfterMs: outcome.retryAfterMs } : {}),
    };
  }

  /** POST /attempts/:id/submit: one transaction, idempotent by attempt (and request id). */
  async submit(user: AuthUser, attemptId: string, dto: SubmitDto): Promise<SubmitResult> {
    const stored = await this.store.readCheckpoint(attemptId);
    let result: SubmitResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<
          {
            userId: string;
            status: string;
            startedAt: Date;
            endsAt: Date;
            layout: unknown;
            graceSeconds: number;
            dbNow: Date;
          }[]
        >`
          SELECT a."user_id" AS "userId", a."status"::text AS "status", a."started_at" AS "startedAt",
                 a."ends_at" AS "endsAt", a."layout", e."grace_seconds" AS "graceSeconds", now() AS "dbNow"
          FROM "attempts" a JOIN "exams" e ON e."id" = a."exam_id"
          WHERE a."id" = ${attemptId}::uuid
          FOR UPDATE OF a`;
        if (!row || row.userId !== user.id) throw new NotFoundException('Attempt not found');

        const existing = await tx.submission.findUnique({
          where: { attemptId },
          select: { id: true, createdAt: true, endReason: true },
        });
        if (existing) return { ...receiptOf(existing), alreadySubmitted: true };
        if (row.status !== 'in_progress' || !withinGrace(row.endsAt, row.graceSeconds, row.dbNow))
          throw refuse('time_over');

        const layout = parseLayout(row.layout);
        if (!answersValid(dto.answers, optionCounts(layout))) throw invalid('answers_invalid');
        const violationCount = Math.max(
          dto.violationCount,
          countViolations(dto.events),
          stored?.violationCount ?? 0,
        );
        if (dto.endReason === 'violations' && violationCount <= EXAM_VIOLATION_WARNINGS)
          throw invalid('violations_not_reached');
        const events =
          dto.events.length >= (stored?.events.length ?? 0) ? dto.events : (stored?.events ?? []);

        const submission = await tx.submission.create({
          data: {
            attemptId,
            requestId: dto.requestId,
            answers: { v: 1, a: dto.answers },
            endReason: dto.endReason,
            violationCount,
            events: events.map((e) => ({ type: e.type, at: e.at })),
          },
          select: { id: true, createdAt: true, endReason: true },
        });
        await tx.attempt.update({
          where: { id: attemptId },
          data: {
            status: 'submitted',
            submittedAt: row.dbNow,
            timeTakenSeconds: timeTakenSeconds(row.startedAt, row.endsAt, row.dbNow),
          },
        });
        return { ...receiptOf(submission), alreadySubmitted: false };
      });
    } catch (e) {
      // The client's request id is unique across all submissions: one that belongs to another attempt is refused.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw refuse('request_id_conflict');
      throw e;
    }
    const meta = await this.store.meta(attemptId);
    if (meta) await this.store.markSubmitted(meta);
    // After the commit, never inside it. If the queue is down the submit still succeeds; the sweep scores it later.
    if (!result.alreadySubmitted) await this.queue.score(attemptId);
    return result;
  }

  private findAttempt(userId: string, examId: string): Promise<AttemptWithSubmission | null> {
    return this.prisma.attempt.findUnique({
      where: { userId_examId: { userId, examId } },
      include: attemptInclude,
    });
  }

  /** Attempt metadata from Redis, or from Postgres (then cached) when Redis has none. */
  private async metaFor(attemptId: string): Promise<AttemptMeta | null> {
    const cached = await this.store.meta(attemptId);
    if (cached) return cached;
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        userId: true,
        examId: true,
        status: true,
        endsAt: true,
        layout: true,
        exam: { select: { graceSeconds: true } },
      },
    });
    if (!attempt) return null;
    const meta = metaOf(attemptId, attempt, attempt.exam.graceSeconds, parseLayout(attempt.layout));
    await this.store.setMeta(meta);
    return meta;
  }

  private async view(attempt: AttemptWithSubmission, config: ExamConfig): Promise<AttemptView> {
    const now = new Date();
    const phase = attemptPhase(attempt, config.graceSeconds, now);
    const base = {
      attemptId: attempt.id,
      examId: attempt.examId,
      title: config.title,
      phase,
      serverNow: now.toISOString(),
      endsAt: attempt.endsAt.toISOString(),
      remainingSeconds: phase === 'in_progress' ? remainingSeconds(attempt.endsAt, now) : 0,
      graceSeconds: config.graceSeconds,
      violationWarnings: EXAM_VIOLATION_WARNINGS,
      receipt: attempt.submission ? receiptOf(attempt.submission) : null,
    };
    if (attempt.submission)
      return {
        ...base,
        questions: [],
        answers: null,
        savedSeq: null,
        violationCount: attempt.submission.violationCount,
      };

    const checkpoint = await this.store.readCheckpoint(attempt.id);
    const violationCount = checkpoint?.violationCount ?? 0;
    if (phase !== 'in_progress')
      return { ...base, questions: [], answers: null, savedSeq: null, violationCount };

    const layout = parseLayout(attempt.layout);
    const versions = await this.cache.versions(layout.q);
    await this.store.setMeta(metaOf(attempt.id, attempt, config.graceSeconds, layout));
    const answers =
      checkpoint?.answers && answersValid(checkpoint.answers, optionCounts(layout))
        ? checkpoint.answers
        : null;
    return {
      ...base,
      questions: renderQuestions(layout, versions),
      answers,
      savedSeq: answers ? checkpoint!.seq : null,
      violationCount,
    };
  }
}

function metaOf(
  attemptId: string,
  attempt: { userId: string; examId: string; status: string; endsAt: Date },
  graceSeconds: number,
  layout: LayoutV1,
): AttemptMeta {
  return {
    attemptId,
    userId: attempt.userId,
    examId: attempt.examId,
    endsAt: attempt.endsAt.getTime(),
    graceSeconds,
    optionCounts: optionCounts(layout),
    submitted: attempt.status !== 'in_progress',
  };
}

function receiptOf(s: {
  id: string;
  createdAt: Date;
  endReason: SubmissionReceipt['endReason'];
}): SubmissionReceipt {
  return { receiptId: s.id, submittedAt: s.createdAt.toISOString(), endReason: s.endReason };
}
