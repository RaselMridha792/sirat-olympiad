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
  AdminAmbassadorRow,
  AmbassadorOverview,
  AmbassadorState,
  Paginated,
} from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { type Actor, AmbassadorsService } from './ambassadors.service';
import { AdminAmbassadorQueryDto, AmbassadorReasonDto } from './dto/ambassador.dto';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** The ambassador's own panel (06-API "Ambassadors"). No id: the user comes from the session. */
@Controller('ambassador')
@Roles('ambassador')
export class AmbassadorController {
  constructor(private readonly ambassadors: AmbassadorsService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<AmbassadorOverview> {
    return this.ambassadors.me(user.id);
  }
}

/** Approve and revoke ambassadors, and the list. Admins only, never managers; every change audited. */
@Controller('admin/ambassadors')
@Roles('admin')
export class AdminAmbassadorsController {
  constructor(private readonly ambassadors: AmbassadorsService) {}

  @Get()
  list(
    @Query() query: AdminAmbassadorQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<Paginated<AdminAmbassadorRow>> {
    return this.ambassadors.list(query, actorOf(user, req));
  }

  @Post(':userId/approve')
  @HttpCode(200)
  approve(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AmbassadorReasonDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AmbassadorState> {
    return this.ambassadors.approve(userId, body.reason, actorOf(user, req));
  }

  @Post(':userId/revoke')
  @HttpCode(200)
  revoke(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AmbassadorReasonDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AmbassadorState> {
    return this.ambassadors.revoke(userId, body.reason, actorOf(user, req));
  }
}
