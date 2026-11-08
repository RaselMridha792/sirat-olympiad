import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { withTimeout } from '../common/with-timeout';
import { Public } from '../modules/auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.module';

/** Each dependency must answer within this time, so a hung DB/Redis cannot hang the readiness probe. */
export const READY_TIMEOUT_MS = 2000;
/**
 * A readiness result stays valid this long per replica: /api/ready is public (the uptime monitor polls it), so a flood
 * of it costs each replica one database round trip and two Redis pings a second, not one per request.
 */
export const READY_CACHE_MS = 1000;

/** Both probes are public: container healthchecks, deploys and the uptime monitor have no session. */
@Public()
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly pingsInFlight = new Map<Redis, Promise<string>>();
  /** The last readiness check (the dependencies that failed), and the one running now, which callers share. */
  private lastCheck: { at: number; failed: string[] } | null = null;
  private checkInFlight: Promise<string[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  /**
   * Liveness: process is up. No dependencies checked. Never rate limited: the container healthchecks of all
   * replicas share one loopback key, and a 429 here would mark a healthy replica unhealthy.
   */
  @SkipThrottle()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: Postgres (via PgBouncer), cache Redis and queue Redis all reachable. Used by the uptime monitor and
   * deploys. The answer comes from a check at most READY_CACHE_MS old; concurrent callers share one check.
   */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    // Clients only get a generic 503; operators see which dependency failed in the log of the check itself.
    if ((await this.readiness()).length > 0)
      throw new ServiceUnavailableException('Dependency not ready');
    return { status: 'ready' };
  }

  private readiness(): Promise<string[]> {
    if (this.lastCheck && Date.now() - this.lastCheck.at < READY_CACHE_MS)
      return Promise.resolve(this.lastCheck.failed);
    this.checkInFlight ??= this.check()
      .then((failed) => {
        this.lastCheck = { at: Date.now(), failed };
        return failed;
      })
      .finally(() => {
        this.checkInFlight = null;
      });
    return this.checkInFlight;
  }

  /** The dependencies that did not answer in time; logged once per check, not once per request. */
  private async check(): Promise<string[]> {
    const checks = {
      database: () => this.prisma.$queryRaw`SELECT 1`,
      redisCache: () => this.ping(this.cache),
      redisQueue: () => this.ping(this.queue),
    };
    const names = Object.keys(checks) as (keyof typeof checks)[];
    const results = await Promise.allSettled(
      names.map((n) => withTimeout(checks[n](), READY_TIMEOUT_MS)),
    );
    const failed = names.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length > 0) this.logger.warn(`readiness failed: ${failed.join(', ')}`);
    return failed;
  }

  /**
   * Never queue a PING on a disconnected client: the queue client (maxRetriesPerRequest: null) would keep every
   * queued PING in memory until Redis returns. One PING in flight per client; concurrent probes share it.
   */
  private ping(client: Redis): Promise<string> {
    if (client.status === 'wait') void client.connect().catch(() => undefined);
    if (client.status !== 'ready') return Promise.reject(new Error(`redis ${client.status}`));
    let pending = this.pingsInFlight.get(client);
    if (!pending) {
      pending = client.ping().finally(() => this.pingsInFlight.delete(client));
      this.pingsInFlight.set(client, pending);
    }
    return pending;
  }
}
