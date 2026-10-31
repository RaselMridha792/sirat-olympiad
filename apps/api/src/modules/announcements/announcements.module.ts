import { Module } from '@nestjs/common';
import { AdminAnnouncementsController, AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/**
 * Announcements: admins write, students read (core C4). Plan: docs/plans/CORE-PLAN.md section 5; contract:
 * docs/06-API.md "Announcements".
 */
@Module({
  controllers: [AnnouncementsController, AdminAnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
