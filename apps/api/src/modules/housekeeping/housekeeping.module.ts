import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { AttemptScrub } from './attempt-scrub';
import { HousekeepingWorker } from './housekeeping.worker';
import { CLEANUP_LIMITS, DEFAULT_CLEANUP_LIMITS, SessionCleanup } from './session-cleanup';

/**
 * Worker side (worker.ts): the nightly session and token cleanup (LAUNCH-PLAN §9, L13) and the registration form's
 * retention (PAYMENTS-PLAN 4.3, D6). AuditService needs only
 * Prisma, so it is provided here rather than importing the API's AuditModule (alerts, email queue).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AuditService,
    SessionCleanup,
    AttemptScrub,
    { provide: CLEANUP_LIMITS, useValue: DEFAULT_CLEANUP_LIMITS },
    HousekeepingWorker,
  ],
})
export class HousekeepingWorkerModule {}
