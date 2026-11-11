import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/access-token.service';
import { CurrentUser, Roles } from '../../auth/auth.decorators';
import {
  ParticipantIdReissueService,
  type ReissueResult,
} from '../registration/participant-id-reissue.service';

/** Why the ID is replaced (audited): e.g. "the student posted the admit card". */
export class ReissueParticipantIdDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 200)
  reason!: string;
}

/** A few a minute is plenty, per IP (the per-user limit also applies). */
const ADMIN_WRITE_TIER = { default: { limit: 20, ttl: 60_000 } };

/**
 * `POST /admin/users/:id/participant-id`: issue a new participant ID (DECISIONS "The participant ID", P1b). Admin only
 * (it ends the student's sessions and changes their login). The answer never carries the ID: it goes to the
 * student's email.
 */
@Roles('admin')
@Controller('admin/users')
export class AdminParticipantIdController {
  constructor(private readonly reissues: ParticipantIdReissueService) {}

  @Throttle(ADMIN_WRITE_TIER)
  @Post(':id/participant-id')
  @HttpCode(200)
  reissue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReissueParticipantIdDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ReissueResult> {
    return this.reissues.reissue({ id: user.id, ip: req.ip ?? null }, id, body.reason);
  }
}
