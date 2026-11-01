import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

/**
 * Admin overview (core; lead 2026-11-01): the admin home's counts (GET /admin/stats) and the audit-log viewer
 * (GET /admin/audit). Both read other teams' tables and write only the export's own audit row.
 * Contract: docs/06-API.md "Admin statistics" and "Audit log".
 */
@Module({
  controllers: [AdminStatsController, AdminAuditController],
  providers: [AdminStatsService, AdminAuditService],
})
export class AdminModule {}
