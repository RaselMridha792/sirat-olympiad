import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  QUESTION_IMPORT_LIMITS,
  type AdminExamCard,
  type AdminExamView,
  type AdminQuestion,
  type Paginated,
  type QuestionImportPreview,
  type QuestionImportResult,
} from '@sirat/shared';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { type Actor, AdminExamsService } from './admin-exams.service';
import {
  CreateExamDto,
  ExamListQueryDto,
  ExamStateChangeDto,
  QuestionDto,
  QuestionImportQueryDto,
  UpdateExamDto,
  UpdateQuestionDto,
} from './dto/admin-exam.dto';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });
const IMPORT_TIER = { default: { limit: 20, ttl: 60_000 } };

/** What the upload interceptor hands over (memory storage; nothing is written to disk). */
interface UploadedCsv {
  buffer: Buffer;
  size: number;
}

/** Exam and question management (06-API "Exam admin"; EXAM-PLAN section 4). Admins only, never managers. */
@Controller('admin/exams')
@Roles('admin')
export class AdminExamsController {
  constructor(private readonly exams: AdminExamsService) {}

  @Get()
  list(@Query() query: ExamListQueryDto): Promise<Paginated<AdminExamCard>> {
    return this.exams.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminExamView> {
    return this.exams.get(id);
  }

  @Post()
  create(
    @Body() body: CreateExamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminExamView> {
    return this.exams.create(body, actorOf(user, req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateExamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminExamView> {
    return this.exams.update(id, body, actorOf(user, req));
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExamStateChangeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminExamView> {
    return this.exams.publish(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExamStateChangeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminExamView> {
    return this.exams.unpublish(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExamStateChangeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminExamView> {
    return this.exams.archive(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Post(':id/questions')
  addQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: QuestionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminQuestion> {
    return this.exams.addQuestion(id, body, actorOf(user, req));
  }

  @Put(':id/questions/:questionId')
  updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() body: UpdateQuestionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminQuestion> {
    return this.exams.updateQuestion(id, questionId, body, actorOf(user, req));
  }

  @Delete(':id/questions/:questionId')
  @HttpCode(204)
  removeQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.exams.removeQuestion(id, questionId, actorOf(user, req));
  }

  /**
   * The CSV import (E7a). One file, at most 1,000,000 bytes (413 above), kept in memory only; the interceptor runs
   * after the admin guard, so nothing is read for anyone else. Dry run 200, import 201.
   */
  @Throttle(IMPORT_TIER)
  @Post(':id/questions/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: QUESTION_IMPORT_LIMITS.maxBytes, files: 1, fields: 0 },
    }),
  )
  importQuestions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QuestionImportQueryDto,
    @UploadedFile() file: UploadedCsv | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QuestionImportPreview | QuestionImportResult> {
    if (!file) throw new BadRequestException(['file is required']);
    const dryRun = query.dryRun === 'true';
    if (dryRun) res.status(200);
    return this.exams.importQuestions(id, file.buffer, dryRun, actorOf(user, req));
  }

  @Get(':id/questions/:questionId/versions')
  versions(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<AdminQuestion[]> {
    return this.exams.versions(id, questionId);
  }
}
