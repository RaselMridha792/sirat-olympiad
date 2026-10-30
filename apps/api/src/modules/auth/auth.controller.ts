import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from '@sirat/shared';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from './access-token.service';
import { CurrentUser, Public } from './auth.decorators';
import { REFRESH_COOKIE, SessionCookies } from './session-cookies';
import { type ClientInfo, SessionService } from './session.service';

const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Session endpoints (06-API). Login, password and email-token endpoints follow. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Rotation. Public, because the access token may already have expired: the refresh cookie is the credential.
   * 409 means another tab refreshed a moment ago; the browser already has the new cookies, so just retry.
   */
  @Public()
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    const result =
      typeof token === 'string' && token !== ''
        ? await this.sessions.rotate(token, clientInfo(req))
        : ({ status: 'invalid' } as const);
    if (result.status === 'rotated') return this.cookies.set(res, result.session);
    if (result.status === 'race') throw new ConflictException('Session was just refreshed, retry');
    this.cookies.clear(res);
    throw new UnauthorizedException('Session expired, log in again');
  }

  /** Ends the session family on this device. The access token alone stays valid until it expires (<= 15 min). */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.endFamilyOfSession(user.sessionId, user.id);
    this.cookies.clear(res);
  }

  /** Ends every session of the user, on every device. */
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ended = await this.sessions.endAllForUser(user.id);
    await this.audit.record({
      action: 'auth.logout_all',
      actorId: user.id,
      ip: req.ip ?? null,
      meta: { sessions: ended },
    });
    this.cookies.clear(res);
  }

  /** The session user, read fresh from the database (role included). A blocked user is logged out. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, role: true, isBlocked: true },
    });
    if (!row || row.isBlocked) throw new UnauthorizedException('Authentication required');
    return { id: row.id, name: row.name, email: row.email, role: row.role };
  }
}
