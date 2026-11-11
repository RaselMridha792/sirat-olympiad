import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/access-token.service';
import { CurrentUser, Roles } from '../../auth/auth.decorators';
import { PageQueryDto } from '../registration/registration.controller';
import {
  AdminDiscountCodesQueryDto,
  CreateDiscountCodeDto,
  UpdateDiscountCodeDto,
} from './admin-discount-codes.dto';
import { AdminDiscountCodesService, type DiscountActor } from './admin-discount-codes.service';

const actorOf = (user: AuthUser, req: Request): DiscountActor => ({
  id: user.id,
  ip: req.ip ?? null,
});
/** Admin writes that touch money: a few a minute is plenty, per IP (the per-user limit also applies). */
const ADMIN_WRITE_TIER = { default: { limit: 20, ttl: 60_000 } };

/** Discount codes (DECISIONS "Discount codes"; payments D1). Admin only: a code changes what registration costs. */
@Roles('admin')
@Controller('admin/discount-codes')
export class AdminDiscountCodesController {
  constructor(private readonly codes: AdminDiscountCodesService) {}

  @Get()
  list(@Query() query: AdminDiscountCodesQueryDto) {
    return this.codes.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.codes.get(id);
  }

  /** The paid uses: who registered with the code, what they paid and what the code took off. */
  @Get(':id/uses')
  uses(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQueryDto) {
    return this.codes.uses(id, query.page ?? 1, query.pageSize ?? 20);
  }

  /** 201 with the code; leave `code` out to have one generated. */
  @Throttle(ADMIN_WRITE_TIER)
  @Post()
  create(@Body() body: CreateDiscountCodeDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.codes.create(actorOf(user, req), body);
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDiscountCodeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.codes.update(actorOf(user, req), id, body);
  }

  /** 204; only a code nobody started a registration with (409 CODE_IN_USE: switch it off instead). */
  @Throttle(ADMIN_WRITE_TIER)
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.codes.remove(actorOf(user, req), id);
  }
}
