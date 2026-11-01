import { Module } from '@nestjs/common';
import { AdminRoundsController, RoundsController } from './rounds.controller';
import { PromotionService } from './promotion.service';
import { RoundsService } from './rounds.service';

/**
 * Rounds (core C6a): rounds as data, promotion from a round to the next, the student's own round. C6b adds the
 * video and the jury. Plan: docs/plans/CORE-PLAN.md section 7; contract: docs/06-API.md "Rounds".
 */
@Module({
  controllers: [RoundsController, AdminRoundsController],
  providers: [RoundsService, PromotionService],
})
export class RoundsModule {}
