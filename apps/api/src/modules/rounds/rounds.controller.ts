import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AdminRound, MyRound, PromotionPreview, PromotionResult } from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  CreateRoundDto,
  PromotionQueryDto,
  PromotionRequestDto,
  UpdateRoundDto,
} from './dto/rounds.dto';
import { PromotionService } from './promotion.service';
import { type Actor, RoundsService } from './rounds.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** The student's own round (06-API "Rounds", core C6a). No id: the user comes from the session. */
@Controller('rounds')
@Roles('student', 'ambassador')
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthUser): Promise<MyRound> {
    return this.rounds.mine(user.id);
  }
}

/** Rounds and promotion for admins (core C6a): every write audited; the services re-read the admin. */
@Controller('admin/rounds')
@Roles('admin')
export class AdminRoundsController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly promotion: PromotionService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<{ items: AdminRound[] }> {
    return this.rounds.list(user.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<AdminRound> {
    return this.rounds.get(user.id, id);
  }

  @Post()
  create(
    @Body() body: CreateRoundDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminRound> {
    return this.rounds.create(body, actorOf(user, req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoundDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminRound> {
    return this.rounds.update(id, body, actorOf(user, req));
  }

  /** Counts only, nothing written: what the run would do now. */
  @Post(':id/promotion/preview')
  @HttpCode(200)
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PromotionQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PromotionPreview> {
    return this.promotion.preview(id, body, user.id);
  }

  @Post(':id/promotion')
  promote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PromotionRequestDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PromotionResult> {
    return this.promotion.run(id, body, actorOf(user, req));
  }
}
