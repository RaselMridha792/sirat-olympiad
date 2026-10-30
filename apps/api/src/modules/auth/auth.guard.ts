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
import { IS_PUBLIC, REQUIRED_ROLES } from './auth.decorators';

/**
 * Global guard, deny by default (RULEBOOK §5): a route needs a valid access-token cookie unless it is @Public(), and
 * the session role must match @Roles() when present. A valid session is also attached on public routes.
 * The acting user only ever comes from here, never from the body or query.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
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
    return true;
  }
}
