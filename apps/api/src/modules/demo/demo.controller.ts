import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AdminDemoStatus, DemoLoadAccepted } from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles, TwoFactorAlways } from '../auth/auth.decorators';
import type { Actor } from '../exams/admin-exams.service';
import { DemoService } from './demo.service';
import { DemoActionDto } from './dto/demo.dto';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/**
 * Demo data, admin only (06-API "Demo data"; DECISIONS 2026-11-08). Load and remove demand a session that proved the
 * second factor whatever the requirement setting says (@TwoFactorAlways; not while 2FA is off, development only).
 */
@Controller('admin/demo')
@Roles('admin')
export class AdminDemoController {
  constructor(private readonly demo: DemoService) {}

  @Get()
  status(): Promise<AdminDemoStatus> {
    return this.demo.status();
  }

  @Post('load')
  @HttpCode(202)
  @TwoFactorAlways()
  load(
    @Body() body: DemoActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<DemoLoadAccepted> {
    return this.demo.load(actorOf(user, req), body.reason);
  }

  @Post('clear')
  @HttpCode(202)
  @TwoFactorAlways()
  clear(
    @Body() body: DemoActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminDemoStatus> {
    return this.demo.clear(actorOf(user, req), body.reason);
  }
}
