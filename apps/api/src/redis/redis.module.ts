import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CACHE = Symbol('REDIS_CACHE'); // allkeys-lru: cache, rate limit, checkpoints
export const REDIS_QUEUE = Symbol('REDIS_QUEUE'); // noeviction + AOF: BullMQ jobs only

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}
  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.cache.quit(), this.queue.quit()]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: () => new Redis(process.env.REDIS_CACHE_URL as string, { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
    {
      provide: REDIS_QUEUE,
      // BullMQ requires maxRetriesPerRequest: null on its connection.
      useFactory: () => new Redis(process.env.REDIS_QUEUE_URL as string, { lazyConnect: true, maxRetriesPerRequest: null }),
    },
    RedisShutdown,
  ],
  exports: [REDIS_CACHE, REDIS_QUEUE],
})
export class RedisModule {}
