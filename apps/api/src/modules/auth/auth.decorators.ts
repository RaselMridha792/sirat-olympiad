import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Role } from '@sirat/shared';
import type { AuthedRequest, AuthUser } from './access-token.service';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';
export const SKIP_CSRF = 'auth:skip-csrf';
export const TWO_FACTOR_OPTIONAL = 'auth:two-factor-optional';
export const TWO_FACTOR_ALWAYS = 'auth:two-factor-always';

/**
 * No session needed. Every route is closed by default; each @Public() route must also be in the reviewed allow-list
 * in test/app-routes.int-spec.ts (06-API "Public allow-list"), or CI fails.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The session user must have one of these roles (403 otherwise). Never combine with @Public(). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Reachable by an admin or manager whose session has not proved a second factor yet, so they can enrol (DECISIONS
 * "Admin two-factor login"). Exactly GET /auth/me, POST /auth/logout and GET /auth/2fa, POST /auth/2fa/setup and
 * POST /auth/2fa/enable: test/app-routes.int-spec.ts fails on any other.
 */
export const TwoFactorOptional = () => SetMetadata(TWO_FACTOR_OPTIONAL, true);

/**
 * The guard demands the second factor on this route even while the requirement setting does not (DECISIONS "The admin
 * 2FA requirement is a setting"): an admin or manager session without the proof gets 403 TWO_FACTOR_REQUIRED. With
 * two-factor login off (no TOTP_ENCRYPTION_KEY, development only) the guard lets it through; the requirement route's
 * own service then answers 503 TWO_FACTOR_UNAVAILABLE. Exactly PUT /admin/security/two-factor-requirement and
 * POST /admin/demo/load and /admin/demo/clear: test/app-routes.int-spec.ts fails on any other.
 */
export const TwoFactorAlways = () => SetMetadata(TWO_FACTOR_ALWAYS, true);

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
