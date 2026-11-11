import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EXAM_VIOLATION_WARNINGS,
  type StudentExamDetail,
  type StudentExamListItem,
  type StudentNextExam,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { attemptPhase, studentExamState } from '../attempts/exam-time';
import { type ExamConfig, ExamCache } from './exam-cache';
import { nextExamFor } from './next-exam';
import { studentAccount, visibleTo } from './student-access';

/** GET /exams and GET /exams/:id (EXAM-PLAN 1.1, 3.11): window state from the server clock, never questions. */
@Injectable()
export class StudentExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ExamCache,
  ) {}

  /** GET /exams/next: nextExamFor (next-exam.ts), wrapped so "none" is a plain JSON null. */
  async next(userId: string): Promise<{ exam: StudentNextExam | null }> {
    return { exam: await nextExamFor(this.prisma, userId) };
  }

  async list(userId: string): Promise<StudentExamListItem[]> {
    const student = await studentAccount(this.prisma, userId);
    const exams = (await this.cache.published()).filter((c) => visibleTo(c, student));
    if (exams.length === 0) return [];
    const attempts = await this.prisma.attempt.findMany({
      where: { userId, examId: { in: exams.map((e) => e.id) } },
      select: { examId: true, status: true, endsAt: true },
    });
    const byExam = new Map(attempts.map((a) => [a.examId, a]));
    const now = new Date();
    return exams.map((c) => listItem(c, byExam.get(c.id) ?? null, now));
  }

  async detail(userId: string, examId: string): Promise<StudentExamDetail> {
    const student = await studentAccount(this.prisma, userId);
    const config = await this.cache.config(examId);
    if (!visibleTo(config, student)) throw new NotFoundException('Exam not found');
    const attempt = await this.prisma.attempt.findUnique({
      where: { userId_examId: { userId, examId } },
      select: {
        id: true,
        status: true,
        endsAt: true,
        submission: { select: { id: true, createdAt: true, endReason: true } },
      },
    });
    const now = new Date();
    return {
      ...listItem(config, attempt, now),
      graceSeconds: config.graceSeconds,
      violationWarnings: EXAM_VIOLATION_WARNINGS,
      serverNow: now.toISOString(),
      attempt: attempt && {
        attemptId: attempt.id,
        phase: attemptPhase(attempt, config.graceSeconds, now),
        endsAt: attempt.endsAt.toISOString(),
        receipt: attempt.submission && {
          receiptId: attempt.submission.id,
          submittedAt: attempt.submission.createdAt.toISOString(),
          endReason: attempt.submission.endReason,
        },
      },
    };
  }
}

function listItem(
  c: ExamConfig,
  attempt: { status: 'in_progress' | 'submitted' | 'expired' | 'scored'; endsAt: Date } | null,
  now: Date,
): StudentExamListItem {
  const windowStart = new Date(c.windowStart);
  const windowEnd = new Date(c.windowEnd);
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    durationMinutes: c.durationMinutes,
    questionsPerAttempt: c.questionsPerAttempt,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    state: studentExamState({ windowStart, windowEnd, graceSeconds: c.graceSeconds }, attempt, now),
    resultsPublished: c.resultsPublishedAt !== null,
  };
}
