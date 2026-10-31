import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Exam, type Question } from '@prisma/client';
import {
  EXAM_LIMITS,
  type AdminExamCard,
  type AdminExamView,
  type AdminQuestion,
  type ExamAdminRefusal,
  type Paginated,
  type QuestionOption,
} from '@sirat/shared';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateExamDto,
  ExamListQueryDto,
  QuestionDto,
  UpdateExamDto,
  UpdateQuestionDto,
} from './dto/admin-exam.dto';
import {
  canExtendWindow,
  publishProblems,
  questionProblems,
  unpublishProblems,
  windowProblems,
} from './exam-rules';
import { ExamCache } from './exam-cache';

type Tx = Prisma.TransactionClient;

/** Who acts: the session user (never a body field) and the client IP for the audit row. */
export interface Actor {
  id: string;
  ip: string | null;
}

/** A refusal the admin screen tells apart: 409 with reason codes in `details` (06-API "Exam admin"). */
const refuse = (...codes: ExamAdminRefusal[]) => new ConflictException(codes);
const invalid = (...codes: ExamAdminRefusal[]) => new BadRequestException(codes);

/** Fields a published exam may still change (EXAM-PLAN 4.1). Everything else is frozen by the database too. */
const PUBLISHED_EDITABLE = new Set(['title', 'windowEnd']);
const CONFIG_FIELDS = [
  'title',
  'category',
  'roundId',
  'windowStart',
  'windowEnd',
  'durationMinutes',
  'questionsPerAttempt',
  'graceSeconds',
  'randomDraw',
] as const;

const DEFAULT_PAGE_SIZE = 20;

const examInclude = {
  round: { select: { id: true, name: true } },
  questions: { where: { isActive: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ExamInclude;
type ExamWithQuestions = Prisma.ExamGetPayload<{ include: typeof examInclude }>;

/**
 * Admin management of exams and questions (EXAM-PLAN section 4). Every write runs in one transaction that locks the
 * exam row (so a publish and a question edit cannot interleave), re-reads the acting admin, and writes its audit row.
 * Once an exam leaves draft its questions are versioned, never rewritten or deleted.
 */
@Injectable()
export class AdminExamsService {
  private readonly logger = new Logger(AdminExamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ExamCache,
  ) {}

  async list(query: ExamListQueryDto): Promise<Paginated<AdminExamCard>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.ExamWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.exam.count({ where }),
      this.prisma.exam.findMany({
        where,
        orderBy: [{ windowStart: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { questions: { where: { isActive: true } } } } },
      }),
    ]);
    return { items: rows.map((e) => toCard(e, e._count.questions)), page, pageSize, total };
  }

  async get(id: string): Promise<AdminExamView> {
    const exam = await this.prisma.exam.findUnique({ where: { id }, include: examInclude });
    if (!exam) throw new NotFoundException('Exam not found');
    return toView(exam);
  }

  async create(dto: CreateExamDto, actor: Actor): Promise<AdminExamView> {
    const windowStart = new Date(dto.windowStart);
    const windowEnd = new Date(dto.windowEnd);
    const problems = windowProblems({
      windowStart,
      windowEnd,
      durationMinutes: dto.durationMinutes,
    });
    if (problems.length) throw invalid(...problems);
    const id = await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      await assertRound(tx, dto.roundId ?? null);
      const exam = await tx.exam.create({
        data: {
          title: dto.title,
          category: dto.category ?? null,
          roundId: dto.roundId ?? null,
          windowStart,
          windowEnd,
          durationMinutes: dto.durationMinutes,
          questionsPerAttempt: dto.questionsPerAttempt,
          graceSeconds: dto.graceSeconds,
          randomDraw: dto.randomDraw,
        },
      });
      await audit(tx, actor, 'exam.created', exam.id, { config: configOf(exam) });
      return exam.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateExamDto, actor: Actor): Promise<AdminExamView> {
    await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, id);
      assertFresh(exam.updatedAt, dto.expectedUpdatedAt);
      if (exam.status === 'archived') throw refuse('exam_archived');

      const changed = CONFIG_FIELDS.filter((f) => dto[f] !== undefined);
      const data: Prisma.ExamUncheckedUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title;

      if (exam.status === 'published') {
        if (changed.some((f) => !PUBLISHED_EDITABLE.has(f))) throw refuse('exam_published');
        if (dto.windowEnd !== undefined) {
          const next = new Date(dto.windowEnd);
          if (!canExtendWindow(exam.windowEnd, next, new Date()))
            throw refuse('window_not_extendable');
          if (!dto.reason) throw new BadRequestException(['reason is required to extend a window']);
          data.windowEnd = next;
        }
      } else {
        if (dto.category !== undefined) data.category = dto.category;
        if (dto.roundId !== undefined) {
          await assertRound(tx, dto.roundId);
          data.roundId = dto.roundId;
        }
        if (dto.windowStart !== undefined) data.windowStart = new Date(dto.windowStart);
        if (dto.windowEnd !== undefined) data.windowEnd = new Date(dto.windowEnd);
        if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
        if (dto.questionsPerAttempt !== undefined)
          data.questionsPerAttempt = dto.questionsPerAttempt;
        if (dto.graceSeconds !== undefined) data.graceSeconds = dto.graceSeconds;
        if (dto.randomDraw !== undefined) data.randomDraw = dto.randomDraw;
        const problems = windowProblems({
          windowStart: (data.windowStart as Date | undefined) ?? exam.windowStart,
          windowEnd: (data.windowEnd as Date | undefined) ?? exam.windowEnd,
          durationMinutes: (data.durationMinutes as number | undefined) ?? exam.durationMinutes,
        });
        if (problems.length) throw invalid(...problems);
      }
      if (changed.length === 0) return;

      const updated = await tx.exam.update({ where: { id }, data });
      const before = configOf(exam);
      const after = configOf(updated);
      const diff = Object.fromEntries(
        changed.map((f) => [f, { from: before[f], to: after[f] }]),
      ) as Prisma.InputJsonObject;
      const extended = exam.status === 'published' && dto.windowEnd !== undefined;
      await audit(tx, actor, extended ? 'exam.window_extended' : 'exam.updated', id, {
        changes: diff,
        ...(extended ? { reason: dto.reason ?? null } : {}),
      });
    });
    await this.afterWrite(id);
    return this.get(id);
  }

  async publish(id: string, expectedUpdatedAt: string, actor: Actor): Promise<AdminExamView> {
    await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, id);
      assertFresh(exam.updatedAt, expectedUpdatedAt);
      if (exam.status !== 'draft')
        throw refuse(exam.status === 'archived' ? 'exam_archived' : 'exam_published');
      const questions = await tx.question.findMany({
        where: { examId: id, isActive: true },
        select: { text: true, options: true, correctKey: true },
      });
      const now = new Date();
      const problems = publishProblems({ ...exam, questions }, now);
      if (problems.length) throw refuse(...problems);
      await tx.exam.update({ where: { id }, data: { status: 'published', publishedAt: now } });
      await audit(tx, actor, 'exam.published', id, {
        questionCount: questions.length,
        contentVersion: exam.contentVersion,
      });
    });
    await this.afterWrite(id, { warm: true });
    return this.get(id);
  }

  async unpublish(id: string, expectedUpdatedAt: string, actor: Actor): Promise<AdminExamView> {
    await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, id);
      assertFresh(exam.updatedAt, expectedUpdatedAt);
      if (exam.status !== 'published')
        throw refuse(exam.status === 'archived' ? 'exam_archived' : 'exam_published');
      const attempts = await tx.attempt.count({ where: { examId: id } });
      const problems = unpublishProblems(
        exam,
        attempts,
        new Date(),
        EXAM_LIMITS.unpublishBeforeStartMinutes,
      );
      if (problems.length) throw refuse(...problems);
      await tx.exam.update({ where: { id }, data: { status: 'draft' } });
      await audit(tx, actor, 'exam.unpublished', id, {});
    });
    await this.afterWrite(id);
    return this.get(id);
  }

  async archive(id: string, expectedUpdatedAt: string, actor: Actor): Promise<AdminExamView> {
    await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, id);
      assertFresh(exam.updatedAt, expectedUpdatedAt);
      if (exam.status === 'archived') throw refuse('exam_archived');
      if (exam.status === 'published' && !exam.resultsPublishedAt)
        throw refuse('results_not_published');
      await tx.exam.update({ where: { id }, data: { status: 'archived' } });
      await audit(tx, actor, 'exam.archived', id, { from: exam.status });
    });
    await this.afterWrite(id);
    return this.get(id);
  }

  async addQuestion(examId: string, dto: QuestionDto, actor: Actor): Promise<AdminQuestion> {
    assertQuestion(dto);
    const created = await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, examId);
      if (exam.status === 'archived') throw refuse('exam_archived');
      if (exam.status === 'published' && !exam.randomDraw) throw refuse('pool_fixed');
      const last = await tx.question.aggregate({
        where: { examId, isActive: true },
        _max: { position: true },
      });
      const question = await tx.question.create({
        data: {
          examId,
          lineageId: randomUUID(),
          position: (last._max.position ?? 0) + 1,
          ...questionData(dto),
        },
      });
      await audit(tx, actor, 'question.created', examId, {
        questionId: question.id,
        lineageId: question.lineageId,
        examStatus: exam.status,
      });
      return toQuestion(question);
    });
    await this.afterWrite(examId);
    return created;
  }

  /** Draft: in place. Published: a new version; attempts already started keep the version they were given. */
  async updateQuestion(
    examId: string,
    questionId: string,
    dto: UpdateQuestionDto,
    actor: Actor,
  ): Promise<AdminQuestion> {
    assertQuestion(dto);
    const saved = await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, examId);
      if (exam.status === 'archived') throw refuse('exam_archived');
      const current = await findQuestion(tx, examId, questionId);
      if (!current.isActive) throw refuse('not_active');
      assertFresh(current.updatedAt, dto.expectedUpdatedAt);

      if (exam.status === 'draft') {
        const updated = await tx.question.update({
          where: { id: questionId },
          data: questionData(dto),
        });
        await audit(tx, actor, 'question.updated', examId, { questionId });
        return toQuestion(updated);
      }
      // Deactivate first: the partial unique index allows one active version per lineage.
      await tx.question.update({
        where: { id: questionId },
        data: { isActive: false, deactivatedAt: new Date() },
      });
      const next = await tx.question.create({
        data: {
          examId,
          lineageId: current.lineageId,
          version: current.version + 1,
          position: current.position,
          ...questionData(dto),
        },
      });
      await audit(tx, actor, 'question.versioned', examId, {
        questionId,
        newQuestionId: next.id,
        lineageId: current.lineageId,
        version: next.version,
      });
      return toQuestion(next);
    });
    await this.afterWrite(examId, { questionId });
    return saved;
  }

  /** Draft: deleted. Published: retired (deactivated), only from a random-draw pool that stays large enough. */
  async removeQuestion(examId: string, questionId: string, actor: Actor): Promise<void> {
    await this.run(async (tx) => {
      await assertAdmin(tx, actor.id);
      const exam = await lockExam(tx, examId);
      if (exam.status === 'archived') throw refuse('exam_archived');
      const current = await findQuestion(tx, examId, questionId);
      if (!current.isActive) throw refuse('not_active');

      if (exam.status === 'draft') {
        await tx.question.delete({ where: { id: questionId } });
        await audit(tx, actor, 'question.deleted', examId, { questionId });
        return;
      }
      if (!exam.randomDraw) throw refuse('pool_fixed');
      const active = await tx.question.count({ where: { examId, isActive: true } });
      if (active - 1 < exam.questionsPerAttempt) throw refuse('pool_too_small');
      await tx.question.update({
        where: { id: questionId },
        data: { isActive: false, deactivatedAt: new Date() },
      });
      await audit(tx, actor, 'question.retired', examId, {
        questionId,
        lineageId: current.lineageId,
      });
    });
    await this.afterWrite(examId, { questionId });
  }

  async versions(examId: string, questionId: string): Promise<AdminQuestion[]> {
    const question = await findQuestion(this.prisma, examId, questionId);
    const rows = await this.prisma.question.findMany({
      where: { lineageId: question.lineageId },
      orderBy: { version: 'asc' },
    });
    return rows.map(toQuestion);
  }

  /**
   * After a committed write: the exam's cached config is dropped (pools are keyed by content version), a draft
   * question's cached text too, and a publish loads the pool ahead of the first start. Best effort: a cache that does
   * not answer only means the next read goes to Postgres.
   */
  private async afterWrite(
    examId: string,
    opts: { questionId?: string; warm?: boolean } = {},
  ): Promise<void> {
    try {
      if (opts.questionId) await this.cache.invalidateQuestion(opts.questionId);
      if (opts.warm) await this.cache.warm(examId);
      else await this.cache.invalidateExam(examId);
    } catch (e) {
      this.logger.warn({ msg: 'exam cache refresh failed', ...errorLogFields(e) });
    }
  }

  /**
   * One write transaction. The service checks every rule first; if the database's lock triggers still refuse (a race
   * the checks did not see), the admin gets the same 409 instead of a 500.
   */
  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (e) {
      if (e instanceof Error && /(exams|questions)_frozen_after_publish/.test(e.message))
        throw refuse('exam_published');
      throw e;
    }
  }
}

/** Roles come from the token (15 min); a write re-reads them, so a demoted or blocked admin stops at once. */
async function assertAdmin(tx: Tx, userId: string): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}

/** Locks the exam row for the rest of the transaction, then reads it. */
async function lockExam(tx: Tx, id: string): Promise<Exam> {
  await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const exam = await tx.exam.findUnique({ where: { id } });
  if (!exam) throw new NotFoundException('Exam not found');
  return exam;
}

async function findQuestion(
  db: Pick<Tx, 'question'>,
  examId: string,
  questionId: string,
): Promise<Question> {
  const question = await db.question.findUnique({ where: { id: questionId } });
  if (!question || question.examId !== examId) throw new NotFoundException('Question not found');
  return question;
}

async function assertRound(tx: Tx, roundId: string | null): Promise<void> {
  if (roundId && !(await tx.round.findUnique({ where: { id: roundId }, select: { id: true } })))
    throw invalid('round_not_found');
}

/** Optimistic concurrency: the screen's copy must be the current one. */
function assertFresh(current: Date, expected: string): void {
  if (current.getTime() !== new Date(expected).getTime()) throw refuse('stale');
}

function assertQuestion(dto: QuestionDto): void {
  const problems = questionProblems(dto);
  if (problems.length) throw invalid(...problems);
}

function questionData(dto: QuestionDto) {
  return {
    text: dto.text,
    options: dto.options.map((o) => ({ key: o.key, text: o.text })),
    correctKey: dto.correctKey,
    explanation: dto.explanation ? dto.explanation : null,
    keepOptionOrder: dto.keepOptionOrder ?? false,
  };
}

/** The audit row is part of the same transaction: no admin change without its record. */
async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  examId: string,
  meta: Prisma.InputJsonObject,
): Promise<void> {
  await tx.auditLog.create({
    data: { action, actorId: actor.id, entityType: 'exam', entityId: examId, ip: actor.ip, meta },
  });
}

function configOf(exam: Exam) {
  return {
    title: exam.title,
    category: exam.category,
    roundId: exam.roundId,
    windowStart: exam.windowStart.toISOString(),
    windowEnd: exam.windowEnd.toISOString(),
    durationMinutes: exam.durationMinutes,
    questionsPerAttempt: exam.questionsPerAttempt,
    graceSeconds: exam.graceSeconds,
    randomDraw: exam.randomDraw,
  };
}

function toCard(exam: Exam, questionCount: number): AdminExamCard {
  return {
    id: exam.id,
    title: exam.title,
    category: exam.category,
    status: exam.status,
    durationMinutes: exam.durationMinutes,
    questionsPerAttempt: exam.questionsPerAttempt,
    windowStart: exam.windowStart.toISOString(),
    windowEnd: exam.windowEnd.toISOString(),
    questionCount,
    locked: exam.status !== 'draft',
  };
}

function toView(exam: ExamWithQuestions): AdminExamView {
  return {
    ...toCard(exam, exam.questions.length),
    graceSeconds: exam.graceSeconds,
    resultsPublishedAt: exam.resultsPublishedAt?.toISOString() ?? null,
    round: exam.round,
    roundId: exam.roundId,
    randomDraw: exam.randomDraw,
    contentVersion: exam.contentVersion,
    publishedAt: exam.publishedAt?.toISOString() ?? null,
    updatedAt: exam.updatedAt.toISOString(),
    questions: exam.questions.map(toQuestion),
  };
}

function toQuestion(q: Question): AdminQuestion {
  return {
    id: q.id,
    lineageId: q.lineageId,
    version: q.version,
    position: q.position,
    text: q.text,
    options: q.options as unknown as QuestionOption[],
    correctKey: q.correctKey,
    explanation: q.explanation,
    keepOptionOrder: q.keepOptionOrder,
    isActive: q.isActive,
    deactivatedAt: q.deactivatedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}
