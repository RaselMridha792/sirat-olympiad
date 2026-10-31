import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Users: the admin students list and export (core C1). The student's own profile (GET/PATCH /users/me) follows
 * in core C3. Plan: docs/plans/CORE-PLAN.md; contract: docs/06-API.md.
 */
@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class UsersModule {}
