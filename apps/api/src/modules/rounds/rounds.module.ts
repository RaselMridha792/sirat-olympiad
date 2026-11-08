import { Module } from '@nestjs/common';
import { AdminRoundsController, JuryController, RoundsController } from './rounds.controller';
import { JuryService } from './jury.service';
import { PromotionService } from './promotion.service';
import { RoundsService } from './rounds.service';
import { VideoService } from './video.service';

/**
 * Rounds (core C6a): rounds as data, promotion from a round to the next, the student's own round; C6b: the video
 * and the jury (assignment, blind scoring). Plan: docs/plans/CORE-PLAN.md section 7; contract: docs/06-API.md "Rounds".
 */
@Module({
  controllers: [RoundsController, AdminRoundsController, JuryController],
  providers: [RoundsService, PromotionService, VideoService, JuryService],
})
export class RoundsModule {}
