import { Module } from '@nestjs/common';
import { AdminExamsController } from './admin-exams.controller';
import { AdminExamsService } from './admin-exams.service';
import { ExamCache } from './exam-cache';
import { StudentExamsController } from './student-exams.controller';
import { StudentExamsService } from './student-exams.service';

/**
 * Exams: admin management of exams and questions (E1), the student's exam list and waiting room (E2), and the exam
 * read cache the attempts module uses. Plan: docs/plans/EXAM-PLAN.md; contract: docs/06-API.md.
 */
@Module({
  controllers: [AdminExamsController, StudentExamsController],
  providers: [AdminExamsService, StudentExamsService, ExamCache],
  exports: [ExamCache],
})
export class ExamsModule {}
