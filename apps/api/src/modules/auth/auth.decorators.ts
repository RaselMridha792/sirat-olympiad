import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Role } from '@sirat/shared';
import type { AuthedRequest, AuthUser } from './access-token.service';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';
export const SKIP_CSRF = 'auth:skip-csrf';

/**
 * No session needed. Every route is closed by default; each @Public() route must also be in the reviewed allow-list
 * in test/app-routes.int-spec.ts (06-API "Public allow-list"), or CI fails.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The session user must have one of these roles (403 otherwise). Never combine with @Public(). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Only for server-to-server callbacks that cannot send the CSRF header (PayStation IPN). Reviewed allow-list in
 * test/app-routes.int-spec.ts.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** The verified session user, set by AuthGuard (undefined on a public route without a valid session). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
