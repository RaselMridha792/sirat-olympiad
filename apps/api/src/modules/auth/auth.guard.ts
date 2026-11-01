import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@sirat/shared';
import { ACCESS_COOKIE, AccessTokenService, type AuthedRequest } from './access-token.service';
import { IS_PUBLIC, REQUIRED_ROLES, TWO_FACTOR_OPTIONAL } from './auth.decorators';
import { twoFactorRequired } from './two-factor/two-factor.errors';
import { TWO_FACTOR_ROLES, TwoFactorConfig } from './two-factor/two-factor.config';

/**
 * Global guard, deny by default (RULEBOOK §5): a route needs a valid access-token cookie unless it is @Public(), and
 * the session role must match @Roles() when present. A valid session is also attached on public routes.
 * The acting user only ever comes from here, never from the body or query.
 *
 * Two-factor login (DECISIONS "Admin two-factor login"): a route whose @Roles() names admin or manager refuses an
 * admin or manager session that has not proved a second factor (403 TWO_FACTOR_REQUIRED), unless the route is
 * @TwoFactorOptional() (enrolment). Never while 2FA is off (no TOTP_ENCRYPTION_KEY, development only).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly twoFactor: TwoFactorConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    const user = typeof token === 'string' && token !== '' ? await this.tokens.verify(token) : null;
    if (user) req.user = user;

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!user) throw new UnauthorizedException('Authentication required');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Not allowed');
    if (
      roles &&
      !user.twoFactor &&
      roles.some((role) => TWO_FACTOR_ROLES.includes(role)) &&
      this.twoFactor.requiredFor(user.role) &&
      !this.reflector.getAllAndOverride<boolean>(TWO_FACTOR_OPTIONAL, targets)
    )
      throw twoFactorRequired();
    return true;
  }
}
