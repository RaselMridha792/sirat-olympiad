import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { AttemptView, CheckpointResult, SubmitResult } from '@sirat/shared';
import type { Response } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AttemptsService } from './attempts.service';
import { CheckpointDto, ResumeQueryDto, SubmitDto } from './dto/attempt.dto';

/**
 * Taking an exam (06-API "Exam engine"; EXAM-PLAN section 3). Students and ambassadors only; every attempt is checked
 * against the session user (another user's attempt answers 404).
 */
@Controller()
@Roles('student', 'ambassador')
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  /** 201 for a new attempt, 200 for the one the student already has (resume, in any phase). */
  @Post('exams/:id/attempts')
  async start(
    @Param('id', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AttemptView> {
    const { created, view } = await this.attempts.start(user, examId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get('attempts/me')
  resume(@Query() query: ResumeQueryDto, @CurrentUser() user: AuthUser): Promise<AttemptView> {
    return this.attempts.resume(user, query.exam);
  }

  /** 429 + Retry-After when sent sooner than the minimum interval; the violation count is kept even then. */
  @Put('attempts/:id/checkpoint')
  async checkpoint(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @Body() body: CheckpointDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckpointResult> {
    const { retryAfterMs, ...result } = await this.attempts.checkpoint(user, attemptId, body);
    if (retryAfterMs !== undefined) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      // Same body shape as the built-in exceptions, so the filter puts the reason code into `details`.
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: ['too_soon'] },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return result;
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  submit(
    @Param('id', ParseUUIDPipe) attemptId: string,
    @Body() body: SubmitDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SubmitResult> {
    return this.attempts.submit(user, attemptId, body);
  }
}
