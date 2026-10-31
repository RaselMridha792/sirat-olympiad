import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import type { EnvVars } from '../../config/env';
import {
  ACCESS_COOKIE,
  AccessTokenService,
  type AuthUser,
} from '../../modules/auth/access-token.service';

/** One signature check per request, shared by the limit and the tracker. */
const VERIFIED = Symbol('throttler.verifiedUser');
type TrackedRequest = Request & { [VERIFIED]?: Promise<AuthUser | null> };

/**
 * The global rate limiter, keyed per route by who is asking (DECISIONS "Per-user API limits"):
 * - a request with a VERIFIED access cookie (signature and expiry) counts against its user, with its own budget
 *   (API_LIMIT_PER_USER_PER_MINUTE), so students behind one school or mobile-operator IP never share one;
 * - anything else (no cookie, or a forged, expired or malformed token) counts against the client IP at the
 *   module's default limit, so nobody can spread requests over invented user keys.
 * A route's own @Throttle() tier always wins. This only counts requests: authorization stays with AuthGuard.
 */
@Injectable()
export class UserOrIpThrottlerGuard extends ThrottlerGuard {
  private readonly perUserLimit: number;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly tokens: AccessTokenService,
    config: ConfigService<EnvVars, true>,
  ) {
    super(options, storage, reflector);
    this.perUserLimit = config.get('API_LIMIT_PER_USER_PER_MINUTE', { infer: true });
  }

  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    // The default limit depends on who asks; an explicit route tier is read first and is left untouched.
    this.throttlers = this.throttlers.map((throttler) => {
      const perIp = throttler.limit;
      if (typeof perIp !== 'number') return throttler;
      return {
        ...throttler,
        limit: async (context: ExecutionContext) =>
          (await this.userOf(context.switchToHttp().getRequest<TrackedRequest>()))
            ? this.perUserLimit
            : perIp,
      };
    });
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = await this.userOf(req as unknown as TrackedRequest);
    // The IP form keeps the library's own normalization (IPv6 grouped by subnet).
    return user ? `user:${user.id}` : `ip:${await super.getTracker(req)}`;
  }

  private userOf(req: TrackedRequest): Promise<AuthUser | null> {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    req[VERIFIED] ??=
      typeof token === 'string' && token !== '' ? this.tokens.verify(token) : Promise.resolve(null);
    return req[VERIFIED];
  }
}
