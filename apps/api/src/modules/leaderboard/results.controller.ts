import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type {
  AdminAttemptDetail,
  AdminAttemptRow,
  AdminExamLeaderboard,
  ExamLeaderboard,
  ExamResultsStatus,
  Paginated,
  ReviewView,
} from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { Actor } from '../exams/admin-exams.service';
import {
  AdminAttemptsQueryDto,
  LeaderboardQueryDto,
  ResultsStateChangeDto,
} from './dto/results.dto';
import { ResultsService } from './results.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** Leaderboards and the student's review (06-API "Results"). */
@Controller()
export class LeaderboardController {
  constructor(private readonly results: ResultsService) {}

  /** Any signed-in user: rank, name and institution only, and only once published (owner Q5). */
  @Get('leaderboard')
  leaderboard(@Query() query: LeaderboardQueryDto): Promise<ExamLeaderboard> {
    return this.results.leaderboard(query);
  }

  @Get('admin/leaderboard')
  @Roles('admin', 'manager')
  adminLeaderboard(@Query() query: LeaderboardQueryDto): Promise<AdminExamLeaderboard> {
    return this.results.adminLeaderboard(query);
  }

  /** The student's own attempt; 403 until the exam's results are published. */
  @Get('attempts/:id/review')
  @Roles('student', 'ambassador')
  review(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewView> {
    return this.results.review(user, attemptId);
  }
}

/** An exam's results and attempts, for admins (06-API "Results"; EXAM-PLAN 3.12, owner Q4). */
@Controller('admin/exams')
@Roles('admin')
export class AdminResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get(':id/results')
  status(@Param('id', ParseUUIDPipe) id: string): Promise<ExamResultsStatus> {
    return this.results.status(id);
  }

  @Post(':id/results/build')
  @HttpCode(202)
  build(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ queued: boolean }> {
    return this.results.build(id, actorOf(user, req));
  }

  @Post(':id/results/publish')
  @HttpCode(200)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResultsStateChangeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ExamResultsStatus> {
    return this.results.publish(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Post(':id/results/unpublish')
  @HttpCode(200)
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResultsStateChangeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ExamResultsStatus> {
    return this.results.unpublish(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Get(':id/attempts')
  attempts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminAttemptsQueryDto,
  ): Promise<Paginated<AdminAttemptRow>> {
    return this.results.attempts(id, query);
  }

  @Get(':id/attempts/:attemptId')
  attempt(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ): Promise<AdminAttemptDetail> {
    return this.results.attempt(id, attemptId);
  }
}
