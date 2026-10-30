import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CACHE } from '../redis/redis.module';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  /** Liveness: process is up. No dependencies checked. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: DB and Redis reachable. Used by uptime monitor and deploy health-check. */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.redis.status === 'wait') await this.redis.connect();
      await this.redis.ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Dependency not ready');
    }
  }
}
