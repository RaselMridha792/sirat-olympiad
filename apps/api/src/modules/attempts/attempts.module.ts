import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ExamsModule } from '../exams/exams.module';
import {
  AttemptStore,
  CHECKPOINT_MIN_INTERVAL_MS,
  DEFAULT_CHECKPOINT_MIN_INTERVAL_MS,
} from './attempt-store';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { DEFAULT_EXAM_JOB_TIMING, EXAM_JOB_TIMING, ExamJobs } from './exam-jobs';
import { ExamQueue } from './exam-queue';
import { ExamWorker } from './exam.worker';

const checkpointInterval = {
  provide: CHECKPOINT_MIN_INTERVAL_MS,
  useValue: DEFAULT_CHECKPOINT_MIN_INTERVAL_MS,
};

/**
 * Taking an exam (E2): start or resume, checkpoints (Redis only), the final submit, which queues the scoring.
 * Plan: docs/plans/EXAM-PLAN.md section 3.
 */
@Module({
  imports: [ExamsModule],
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptStore, ExamQueue, checkpointInterval],
  exports: [AttemptStore, ExamQueue],
})
export class AttemptsModule {}

/** Worker side (worker.ts): scoring, the minute sweep and results builds (E3; EXAM-PLAN 3.9, 3.10, 3.12). */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    AttemptStore,
    checkpointInterval,
    ExamJobs,
    { provide: EXAM_JOB_TIMING, useValue: DEFAULT_EXAM_JOB_TIMING },
    ExamWorker,
  ],
})
export class ExamWorkerModule {}
