import { Controller, Get } from '@nestjs/common';
import type { AdminStats } from '@sirat/shared';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AdminStatsService } from './admin-stats.service';

/** The admin home's counts (06-API "Admin statistics"): admins and managers; jury and students get 403. */
@Controller('admin/stats')
@Roles('admin', 'manager')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<AdminStats> {
    return this.stats.get(user.id);
  }
}
