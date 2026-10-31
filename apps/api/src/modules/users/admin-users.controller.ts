import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ADMIN_USER_EXPORT,
  type AdminUserDetail,
  type AdminUserRow,
  type Paginated,
  type StudentProfile,
} from '@sirat/shared';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { type Actor, AdminUsersService } from './admin-users.service';
import { AdminUserListQueryDto, ExportUsersDto } from './dto/admin-users.dto';
import { CorrectGradeDto } from './dto/profile.dto';
import { ProfileService } from './profile.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** Exports per admin per hour; the per-user key of UserOrIpThrottlerGuard makes it per admin. */
const EXPORT_TIER = { default: { limit: ADMIN_USER_EXPORT.perHour, ttl: 60 * 60 * 1000 } };

/** The admin students list (06-API "Admin students list"; core plan section 2). Admins only, never managers. */
@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly users: AdminUsersService,
    private readonly profiles: ProfileService,
  ) {}

  @Get()
  list(
    @Query() query: AdminUserListQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<Paginated<AdminUserRow>> {
    return this.users.list(query, actorOf(user, req));
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminUserDetail> {
    return this.users.get(id, actorOf(user, req));
  }

  /** Corrects the class (and so the category) before the student's first exam attempt; audited. */
  @Post(':id/grade-level')
  @HttpCode(200)
  correctGrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CorrectGradeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<StudentProfile> {
    return this.profiles.correctGrade(id, body, actorOf(user, req));
  }

  @Throttle(EXPORT_TIER)
  @Post('export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async export(
    @Body() body: ExportUsersDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const out = await this.users.export(body.filters, body.reason, actorOf(user, req));
    const file = new StreamableFile(Readable.from(out.chunks), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${out.filename}"`,
    });
    // Nest's handler cuts the download short when a batch fails after the headers went out (the browser then
    // reports a failed file, never a short one), but its logger prints the error's message, and a Prisma message
    // quotes query values (A2.0 gate 1). So only the logger is replaced.
    file.setErrorLogger((err: Error) => {
      this.logger.error({ msg: 'users export failed while streaming', ...errorLogFields(err) });
    });
    return file;
  }
}
