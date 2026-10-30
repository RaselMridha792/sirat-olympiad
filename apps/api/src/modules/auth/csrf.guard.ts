import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SKIP_CSRF } from './auth.decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every state-changing request must carry an `X-Requested-With` header (06-API), on top of
 * SameSite=Lax cookies. A cross-site form cannot set a custom header, and a cross-origin script cannot send one
 * without a CORS preflight, which the API never answers. Public routes are covered too: login CSRF needs no cookie.
 * GET handlers must never change state.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;
    if (req.get('x-requested-with')) return true;
    throw new ForbiddenException('Missing X-Requested-With header');
  }
}
