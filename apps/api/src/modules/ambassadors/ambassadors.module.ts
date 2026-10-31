import { Module } from '@nestjs/common';
import { AdminAmbassadorsController, AmbassadorController } from './ambassadors.controller';
import { AmbassadorsService } from './ambassadors.service';

/**
 * Ambassadors (core C5a): admins approve and revoke, the server assigns the promo code, the ambassador sees their
 * panel. Attribution only: no fee or payment changes. Points, tasks and teams follow in core C5b.
 * Plan: docs/plans/CORE-PLAN.md section 6; contract: docs/06-API.md "Ambassadors".
 */
@Module({
  controllers: [AmbassadorController, AdminAmbassadorsController],
  providers: [AmbassadorsService],
})
export class AmbassadorsModule {}
