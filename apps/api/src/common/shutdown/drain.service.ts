import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';

/**
 * Hard limit for the HTTP drain after SIGTERM. Keep it below compose `stop_grace_period` (35 s) minus the pool
 * shutdown (Redis quit is bounded to 2 s), so Prisma and Redis still close cleanly before Docker kills the process.
 */
export const DRAIN_DEADLINE_MS = 28_000;

/**
 * Graceful drain behind nginx keep-alive (RULEBOOK §4: finish in-flight requests, then close pools).
 * `server.close()` only closes connections that are idle at that instant; nginx keeps reusing busy keep-alive
 * connections, so without this the drain never finished and the pools were never closed.
 * While draining, every response says `Connection: close`, so nginx drops the connection after it.
 */
@Injectable()
export class DrainService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(DrainService.name);
  private draining = false;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  isDraining(): boolean {
    return this.draining;
  }

  /** Runs before Nest closes the HTTP server (dispose) and before the pools close (onApplicationShutdown). */
  beforeApplicationShutdown(): void {
    this.draining = true;
    const server = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!server) return;
    this.logger.log('draining HTTP connections');
    // Last resort for clients that keep a connection busy past the deadline. unref(): never keeps the process alive.
    setTimeout(() => server.closeAllConnections(), DRAIN_DEADLINE_MS).unref();
  }

  /** Register first in main.ts so it applies to every response. */
  middleware() {
    return (_req: Request, res: Response, next: NextFunction): void => {
      if (this.draining) res.setHeader('Connection', 'close');
      next();
    };
  }
}
