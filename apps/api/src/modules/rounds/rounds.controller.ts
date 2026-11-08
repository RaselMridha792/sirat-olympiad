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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type {
  AdminRound,
  AdminRoundJury,
  JuryAssignResult,
  JuryEntryRow,
  JuryRound,
  JuryScoreResult,
  MyRound,
  Paginated,
  PromotionPreview,
  PromotionResult,
} from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  CreateRoundDto,
  JuryAssignDto,
  JuryEntryQueryDto,
  JuryScoreDto,
  PromotionQueryDto,
  PromotionRequestDto,
  UpdateRoundDto,
  VideoSubmitDto,
} from './dto/rounds.dto';
import { JuryService } from './jury.service';
import { PromotionService } from './promotion.service';
import { type Actor, RoundsService } from './rounds.service';
import { VideoService } from './video.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** The student's own round (06-API "Rounds", core C6a). No id: the user comes from the session. */
@Controller('rounds')
@Roles('student', 'ambassador')
export class RoundsController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly video: VideoService,
  ) {}

  @Get('me')
  mine(@CurrentUser() user: AuthUser): Promise<MyRound> {
    return this.rounds.mine(user.id);
  }

  /** The student's own video link for a video round (core C6b); only their own entry, inside the window. */
  @Put(':id/video')
  submitVideo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VideoSubmitDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<MyRound> {
    return this.video.submit(id, body.url, actorOf(user, req));
  }
}

/** Rounds and promotion for admins (core C6a): every write audited; the services re-read the admin. */
@Controller('admin/rounds')
@Roles('admin')
export class AdminRoundsController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly promotion: PromotionService,
    private readonly jury: JuryService,
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

  /** The round's judges and the jury-role accounts that can be added (core C6b). */
  @Get(':id/jury')
  roundJury(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminRoundJury> {
    return this.jury.roundJury(user.id, id);
  }

  @Post(':id/jury')
  @HttpCode(200)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: JuryAssignDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<JuryAssignResult> {
    return this.jury.assign(id, body, actorOf(user, req));
  }

  @Delete(':id/jury/:assignmentId')
  @HttpCode(204)
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.jury.unassign(id, assignmentId, actorOf(user, req));
  }
}

/** The jury's own work (core C6b): only the judge's rounds and categories, blind; the service re-reads the role. */
@Controller('jury')
@Roles('jury')
export class JuryController {
  constructor(private readonly jury: JuryService) {}

  @Get('rounds')
  rounds(@CurrentUser() user: AuthUser): Promise<JuryRound[]> {
    return this.jury.rounds(user.id);
  }

  @Get('entries')
  entries(
    @Query() query: JuryEntryQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<JuryEntryRow>> {
    return this.jury.entries(user.id, query);
  }

  @Post('entries/:entryId/scores')
  score(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: JuryScoreDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<JuryScoreResult> {
    return this.jury.score(entryId, body, actorOf(user, req));
  }
}
