import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { ProfileOptions, StudentProfile } from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { UpdateProfileDto } from './dto/profile.dto';
import { ProfileService } from './profile.service';

/** The student's own profile (06-API "Student profile"). No id in any route: the user comes from the session. */
@Controller('users/me')
@Roles('student', 'ambassador')
export class UsersController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<StudentProfile> {
    return this.profiles.me(user.id);
  }

  @Patch()
  update(
    @Body() body: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<StudentProfile> {
    return this.profiles.update(user.id, body, req.ip ?? null);
  }
}

/**
 * Option lists of the profile form: the grade table, the 64 districts, the education types. Admins read it too, for
 * the grade correction dialog; none of it is personal data.
 */
@Controller('content')
@Roles('student', 'ambassador', 'admin')
export class ProfileOptionsController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile-options')
  options(): Promise<ProfileOptions> {
    return this.profiles.options();
  }
}
