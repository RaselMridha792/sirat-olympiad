import { Module } from '@nestjs/common';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

/**
 * Admin overview (core; lead 2026-11-01): the admin home's counts, GET /admin/stats. Reads payments' and exam's
 * tables, writes none. The audit-log viewer follows here. Contract: docs/06-API.md "Admin statistics".
 */
@Module({
  controllers: [AdminStatsController],
  providers: [AdminStatsService],
})
export class AdminModule {}
