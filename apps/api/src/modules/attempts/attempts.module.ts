import { Module } from '@nestjs/common';
import { ExamsModule } from '../exams/exams.module';
import {
  AttemptStore,
  CHECKPOINT_MIN_INTERVAL_MS,
  DEFAULT_CHECKPOINT_MIN_INTERVAL_MS,
} from './attempt-store';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';

/**
 * Taking an exam (E2): start or resume, checkpoints (Redis only), the final submit. Scoring and the server-side
 * finalize run in the worker (E3). Plan: docs/plans/EXAM-PLAN.md section 3.
 */
@Module({
  imports: [ExamsModule],
  controllers: [AttemptsController],
  providers: [
    AttemptsService,
    AttemptStore,
    { provide: CHECKPOINT_MIN_INTERVAL_MS, useValue: DEFAULT_CHECKPOINT_MIN_INTERVAL_MS },
  ],
})
export class AttemptsModule {}
