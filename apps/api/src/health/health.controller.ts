import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { withTimeout } from '../common/with-timeout';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.module';

/** Each dependency must answer within this time, so a hung DB/Redis cannot hang the readiness probe. */
export const READY_TIMEOUT_MS = 2000;

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  /** Liveness: process is up. No dependencies checked. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: Postgres (via PgBouncer), cache Redis and queue Redis all reachable. Used by uptime monitor and deploys. */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    const checks = {
      database: () => this.prisma.$queryRaw`SELECT 1`,
      redisCache: () => this.cache.ping(),
      redisQueue: () => this.queue.ping(),
    };
    const names = Object.keys(checks) as (keyof typeof checks)[];
    const results = await Promise.allSettled(names.map((n) => withTimeout(checks[n](), READY_TIMEOUT_MS)));
    const failed = names.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length > 0) {
      // Operators see which dependency failed in the logs; clients only get a generic 503.
      this.logger.warn(`readiness failed: ${failed.join(', ')}`);
      throw new ServiceUnavailableException('Dependency not ready');
    }
    return { status: 'ready' };
  }
}
