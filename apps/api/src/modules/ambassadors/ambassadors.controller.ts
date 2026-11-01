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
import type {
  AdminAmbassadorRow,
  AmbassadorOverview,
  AmbassadorPointsConfig,
  AmbassadorState,
  Paginated,
  PointsAdjustResult,
} from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AmbassadorPointsService } from './ambassador-points.service';
import { type Actor, AmbassadorsService } from './ambassadors.service';
import { AdjustPointsDto, UpdateAmbassadorPointsDto } from './dto/ambassador-points.dto';
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

/** Points settings and adjustments (06-API "Ambassadors", core C5b): admins only, audited. */
@Controller('admin')
@Roles('admin')
export class AdminAmbassadorPointsController {
  constructor(private readonly points: AmbassadorPointsService) {}

  @Get('ambassador-points')
  get(@CurrentUser() user: AuthUser): Promise<AmbassadorPointsConfig> {
    return this.points.get(user.id);
  }

  @Put('ambassador-points')
  update(
    @Body() body: UpdateAmbassadorPointsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AmbassadorPointsConfig> {
    return this.points.update(body, actorOf(user, req));
  }

  @Post('points/adjust')
  @HttpCode(200)
  adjust(
    @Body() body: AdjustPointsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PointsAdjustResult> {
    return this.points.adjust(body, actorOf(user, req));
  }
}
