import { Module } from '@nestjs/common';
import { AdminExamsController } from './admin-exams.controller';
import { AdminExamsService } from './admin-exams.service';

/**
 * Exams: admin management of exams and questions (E1). The student endpoints (GET /exams, attempts) follow in E2.
 * Plan: docs/plans/EXAM-PLAN.md; contract: docs/06-API.md "Exam admin".
 */
@Module({
  controllers: [AdminExamsController],
  providers: [AdminExamsService],
})
export class ExamsModule {}
