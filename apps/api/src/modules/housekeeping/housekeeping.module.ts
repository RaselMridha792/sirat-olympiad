import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { HousekeepingWorker } from './housekeeping.worker';
import { CLEANUP_LIMITS, DEFAULT_CLEANUP_LIMITS, SessionCleanup } from './session-cleanup';

/**
 * Worker side (worker.ts): the nightly session and token cleanup (LAUNCH-PLAN §9, L13). AuditService needs only
 * Prisma, so it is provided here rather than importing the API's AuditModule (alerts, email queue).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AuditService,
    SessionCleanup,
    { provide: CLEANUP_LIMITS, useValue: DEFAULT_CLEANUP_LIMITS },
    HousekeepingWorker,
  ],
})
export class HousekeepingWorkerModule {}
