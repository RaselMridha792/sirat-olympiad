import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { ProfileService } from './profile.service';
import { ProfileOptionsController, UsersController } from './users.controller';

/**
 * Users: the admin students list and export (core C1), the student's own profile and the admin's grade
 * correction (core C3). Plan: docs/plans/CORE-PLAN.md; contract: docs/06-API.md.
 */
@Module({
  controllers: [AdminUsersController, UsersController, ProfileOptionsController],
  providers: [AdminUsersService, ProfileService],
})
export class UsersModule {}
