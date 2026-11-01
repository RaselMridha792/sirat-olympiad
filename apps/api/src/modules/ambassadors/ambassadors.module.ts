import { Module } from '@nestjs/common';
import {
  AdminAmbassadorPointsController,
  AdminAmbassadorsController,
  AdminTasksController,
  AdminTeamsController,
  AmbassadorController,
  TeamsController,
} from './ambassadors.controller';
import { AmbassadorPointsService } from './ambassador-points.service';
import { AmbassadorTasksService } from './ambassador-tasks.service';
import { TeamsService } from './teams.service';
import { AmbassadorsService } from './ambassadors.service';

/**
 * Ambassadors (core C5a): admins approve and revoke, the server assigns the promo code, the ambassador sees their
 * panel. Attribution only: no fee or payment changes. C5b: referral points (the sweep runs in the worker,
 * ambassador-points.worker.ts), the points settings and adjustments; tasks and teams follow.
 * Plan: docs/plans/CORE-PLAN.md section 6; contract: docs/06-API.md "Ambassadors".
 */
@Module({
  controllers: [
    AmbassadorController,
    AdminAmbassadorsController,
    AdminAmbassadorPointsController,
    AdminTasksController,
    AdminTeamsController,
    TeamsController,
  ],
  providers: [AmbassadorsService, AmbassadorPointsService, AmbassadorTasksService, TeamsService],
})
export class AmbassadorsModule {}
