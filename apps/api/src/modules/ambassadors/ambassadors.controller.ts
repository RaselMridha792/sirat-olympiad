import {
  Body,
  Controller,
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
import { Throttle } from '@nestjs/throttler';
import {
  TEAM_LIMITS,
  TASK_LIMITS,
  type AdminTeamDetail,
  type AdminTeamRow,
  type MyTeam,
  type AdminTaskReviewRow,
  type AdminTaskRow,
  type TaskAssignResult,
  type TaskReviewResult,
} from '@sirat/shared';
import type {
  AdminAmbassadorRow,
  AmbassadorLeaderboard,
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
import { AmbassadorTasksService } from './ambassador-tasks.service';
import { TeamsService } from './teams.service';
import { AdminTeamQueryDto, CreateTeamDto, JoinTeamDto, RenameTeamDto } from './dto/teams.dto';
import { type Actor, AmbassadorsService } from './ambassadors.service';
import { AdjustPointsDto, UpdateAmbassadorPointsDto } from './dto/ambassador-points.dto';
import {
  AdminTaskQueryDto,
  AssignTaskDto,
  CreateTaskDto,
  PatchTaskDto,
  RejectTaskDto,
  ReviewQueueQueryDto,
  SubmitProofDto,
} from './dto/ambassador-tasks.dto';
import {
  AdminAmbassadorQueryDto,
  AmbassadorLeaderboardQueryDto,
  AmbassadorReasonDto,
} from './dto/ambassador.dto';
import { AmbassadorLeaderboardService } from './ambassador-leaderboard.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** Proof submissions per ambassador (lead: a rejected task can be submitted again, so it is bounded). */
const SUBMIT_TIER = { default: { limit: TASK_LIMITS.submitsPer10Min, ttl: 10 * 60 * 1000 } };
/** Team joins per user in 10 minutes; the service adds a per-IP count (refusals count too: the codes are short). */
const JOIN_TIER = { default: { limit: TEAM_LIMITS.joinsPerUser, ttl: 10 * 60 * 1000 } };

/** The ambassador's own panel (06-API "Ambassadors"). No id: the user comes from the session. */
@Controller('ambassador')
@Roles('ambassador')
export class AmbassadorController {
  constructor(
    private readonly ambassadors: AmbassadorsService,
    private readonly tasks: AmbassadorTasksService,
    private readonly teams: TeamsService,
    private readonly leaderboard: AmbassadorLeaderboardService,
  ) {}

  /** One team per ambassador; the owner becomes its first member. */
  @Post('teams')
  createTeam(
    @Body() body: CreateTeamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<MyTeam> {
    return this.teams.create(body.name, actorOf(user, req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<AmbassadorOverview> {
    return this.ambassadors.me(user.id);
  }

  /** The ambassadors of the caller's side by points (A4), with the caller's own place; cached for up to a minute. */
  @Get('leaderboard')
  board(
    @Query() query: AmbassadorLeaderboardQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AmbassadorLeaderboard> {
    return this.leaderboard.page(user.id, query);
  }

  /** The ambassador's proof for their own task (plain text; never logged or audited). */
  @Throttle(SUBMIT_TIER)
  @Post('tasks/:assignmentId/submit')
  @HttpCode(204)
  submit(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() body: SubmitProofDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.tasks.submit(user.id, assignmentId, body.proof, req.ip ?? null);
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

/** Ambassador tasks and their review (06-API "Ambassadors", core C5b-2): admins only, every change audited. */
@Controller('admin')
@Roles('admin')
export class AdminTasksController {
  constructor(private readonly tasks: AmbassadorTasksService) {}

  @Get('tasks')
  list(
    @Query() query: AdminTaskQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AdminTaskRow>> {
    return this.tasks.list(user.id, query);
  }

  @Post('tasks')
  create(
    @Body() body: CreateTaskDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminTaskRow> {
    return this.tasks.create(body, actorOf(user, req));
  }

  @Patch('tasks/:id')
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchTaskDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminTaskRow> {
    return this.tasks.patch(id, body, actorOf(user, req));
  }

  @Post('tasks/:id/archive')
  @HttpCode(200)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminTaskRow> {
    return this.tasks.setArchived(id, true, actorOf(user, req));
  }

  @Post('tasks/:id/restore')
  @HttpCode(200)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminTaskRow> {
    return this.tasks.setArchived(id, false, actorOf(user, req));
  }

  @Post('tasks/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignTaskDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<TaskAssignResult> {
    return this.tasks.assign(id, body.userIds, actorOf(user, req));
  }

  @Get('task-assignments')
  reviewQueue(
    @Query() query: ReviewQueueQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AdminTaskReviewRow>> {
    return this.tasks.reviewQueue(user.id, query);
  }

  @Post('task-assignments/:id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<TaskReviewResult> {
    return this.tasks.approve(id, actorOf(user, req));
  }

  @Post('task-assignments/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectTaskDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<TaskReviewResult> {
    return this.tasks.reject(id, body.note, actorOf(user, req));
  }
}

/** A student's or an ambassador's own team (06-API "Ambassadors", core C5b-3). No id: the user comes from the session. */
@Controller('teams')
@Roles('student', 'ambassador')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser): Promise<MyTeam> {
    return this.teams.mine(user.id);
  }

  @Throttle(JOIN_TIER)
  @Post('join')
  @HttpCode(200)
  join(
    @Body() body: JoinTeamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<MyTeam> {
    return this.teams.join(body.code, actorOf(user, req));
  }

  @Post('mine/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    return this.teams.leave(actorOf(user, req));
  }
}

/** Teams for admins: list, detail with members, and rename (moderation, audited with a reason). */
@Controller('admin/teams')
@Roles('admin')
export class AdminTeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(
    @Query() query: AdminTeamQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AdminTeamRow>> {
    return this.teams.list(user.id, query);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminTeamDetail> {
    return this.teams.get(user.id, id);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameTeamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminTeamRow> {
    return this.teams.rename(id, body, actorOf(user, req));
  }
}
