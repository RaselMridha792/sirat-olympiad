import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { StudentExamDetail, StudentExamListItem, StudentNextExam } from '@sirat/shared';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { StudentExamsService } from './student-exams.service';

/** The student's exam list and waiting room (06-API "Exam engine"). Never questions. */
@Controller('exams')
@Roles('student', 'ambassador')
export class StudentExamsController {
  constructor(private readonly exams: StudentExamsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<StudentExamListItem[]> {
    return this.exams.list(user.id);
  }

  /** The next olympiad exam for the admit card's countdown (before ':id', so "next" is never read as an id). */
  @Get('next')
  next(@CurrentUser() user: AuthUser): Promise<{ exam: StudentNextExam | null }> {
    return this.exams.next(user.id);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StudentExamDetail> {
    return this.exams.detail(user.id, id);
  }
}
