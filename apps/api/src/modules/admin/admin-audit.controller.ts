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
import { ADMIN_AUDIT_EXPORT, type AdminAuditDetail, type AdminAuditPage } from '@sirat/shared';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditQueryDto, ExportAuditDto } from './dto/admin-audit.dto';

/** Exports per admin per hour; the per-user key of UserOrIpThrottlerGuard makes it per admin. */
const EXPORT_TIER = { default: { limit: ADMIN_AUDIT_EXPORT.perHour, ttl: 60 * 60 * 1000 } };

/** The audit-log viewer (06-API "Audit log"): admins only, read only. */
@Controller('admin/audit')
@Roles('admin')
export class AdminAuditController {
  private readonly logger = new Logger(AdminAuditController.name);

  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(@Query() query: AdminAuditQueryDto, @CurrentUser() user: AuthUser): Promise<AdminAuditPage> {
    return this.audit.list(user.id, query);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminAuditDetail> {
    return this.audit.get(user.id, id);
  }

  @Throttle(EXPORT_TIER)
  @Post('export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async export(
    @Body() body: ExportAuditDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const { reason, ...filters } = body;
    const out = await this.audit.export(filters, reason, { id: user.id, ip: req.ip ?? null });
    const file = new StreamableFile(Readable.from(out.chunks), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${out.filename}"`,
    });
    // As for the students export: Nest's own logger would print the error message, which may quote query values.
    file.setErrorLogger((err: Error) => {
      this.logger.error({ msg: 'audit export failed while streaming', ...errorLogFields(err) });
    });
    return file;
  }
}
