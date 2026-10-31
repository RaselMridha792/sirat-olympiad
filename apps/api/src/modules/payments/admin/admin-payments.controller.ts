import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Allow, IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/access-token.service';
import { CurrentUser, Roles } from '../../auth/auth.decorators';
import { AdminPaymentsQueryDto, ReconcilePaymentDto } from './admin-payments.dto';
import { type Actor, AdminPaymentsService } from './admin-payments.service';
import { AdminSettingsService } from './admin-settings.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });
/** Admin writes that touch money or settings: a few a minute is plenty, per IP (the per-user limit also applies). */
const ADMIN_WRITE_TIER = { default: { limit: 20, ttl: 60_000 } };

/** Admin payments (plan 6.7). Admin only: a manager does not see payers' contact data or touch payments. */
@Roles('admin')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Get()
  list(@Query() query: AdminPaymentsQueryDto) {
    return this.payments.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  /** 202: the worker asks PayStation; the page reads the result with GET. */
  @Throttle(ADMIN_WRITE_TIER)
  @Post(':id/recheck')
  @HttpCode(202)
  recheck(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payments.recheck(actorOf(user, req), id);
  }

  /** Only a success PayStation reported without a trx_id (AdminPaymentsService.reconcile). */
  @Throttle(ADMIN_WRITE_TIER)
  @Post(':id/reconcile')
  @HttpCode(200)
  reconcile(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReconcilePaymentDto,
  ) {
    return this.payments.reconcile(actorOf(user, req), id, body);
  }
}

export class UpdateSettingDto {
  /** Checked per key by the service (each setting has its own rule). */
  @Allow()
  value?: unknown;

  /** The value the admin's form showed; must still be the current one (409 otherwise). */
  @Allow()
  expected?: unknown;

  @IsOptional()
  @IsString()
  @Length(3, 200)
  reason?: string;
}

/** Registration and payment settings (plan 3.4). Admin only, not manager. */
@Roles('admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Put(':key')
  update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('key') key: string,
    @Body() body: UpdateSettingDto,
  ) {
    return this.settings.update(actorOf(user, req), key, body);
  }
}
