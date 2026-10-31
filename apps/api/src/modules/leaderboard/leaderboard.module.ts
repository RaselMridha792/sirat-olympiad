import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { ExamsModule } from '../exams/exams.module';
import { AdminResultsController, LeaderboardController } from './results.controller';
import { ResultsService } from './results.service';

/**
 * Results (E3): the admin's results controls and attempts list, the leaderboards and the student's review.
 * Plan: docs/plans/EXAM-PLAN.md 3.12; contract: docs/06-API.md "Results".
 */
@Module({
  imports: [ExamsModule, AttemptsModule],
  controllers: [LeaderboardController, AdminResultsController],
  providers: [ResultsService],
})
export class LeaderboardModule {}
