import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AdminAnnouncement, AnnouncementItem, Paginated } from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { type Actor, AnnouncementsService } from './announcements.service';
import {
  AdminAnnouncementQueryDto,
  AnnouncementStateDto,
  CreateAnnouncementDto,
  PageQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** Live announcements for the student's category or everyone (06-API "Announcements"). */
@Controller('announcements')
@Roles('student', 'ambassador')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(
    @Query() query: PageQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AnnouncementItem>> {
    return this.announcements.listForStudent(user.id, query);
  }
}

/** Write, edit, archive and restore announcements. Admins only, never managers; every write audited. */
@Controller('admin/announcements')
@Roles('admin')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(
    @Query() query: AdminAnnouncementQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<Paginated<AdminAnnouncement>> {
    return this.announcements.list(query, actorOf(user, req));
  }

  @Post()
  create(
    @Body() body: CreateAnnouncementDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminAnnouncement> {
    return this.announcements.create(body, actorOf(user, req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAnnouncementDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminAnnouncement> {
    return this.announcements.update(id, body, actorOf(user, req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AnnouncementStateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminAnnouncement> {
    return this.announcements.archive(id, body.expectedUpdatedAt, actorOf(user, req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AnnouncementStateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminAnnouncement> {
    return this.announcements.restore(id, body.expectedUpdatedAt, actorOf(user, req));
  }
}
