import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import { withTimeout } from '../common/with-timeout';

export const REDIS_CACHE = Symbol('REDIS_CACHE'); // allkeys-lru: cache, rate limit, checkpoints
export const REDIS_QUEUE = Symbol('REDIS_QUEUE'); // noeviction + AOF: BullMQ jobs only

/** Exported so tests exercise the exact production client options. Clients connect at boot (no lazyConnect). */
export const CACHE_REDIS_OPTIONS: RedisOptions = { maxRetriesPerRequest: 2 };
// BullMQ requires maxRetriesPerRequest: null on its connection.
export const QUEUE_REDIS_OPTIONS: RedisOptions = { maxRetriesPerRequest: null };

const QUIT_TIMEOUT_MS = 2_000;
const ERROR_LOG_EVERY_MS = 30_000;

/**
 * Creates a client whose errors go through the app logger (message only: the URL can carry a password),
 * rate-limited per client. Without a listener ioredis prints raw stack traces outside the JSON logs.
 */
function createClient(name: string, url: string, options: RedisOptions): Redis {
  const logger = new Logger(`Redis:${name}`);
  const client = new Redis(url, options);
  let lastErrorLogAt = 0;
  let failing = false;
  client.on('error', (err: Error) => {
    failing = true;
    const now = Date.now();
    if (now - lastErrorLogAt < ERROR_LOG_EVERY_MS) return;
    lastErrorLogAt = now;
    logger.warn(`connection error: ${err.message}`);
  });
  client.on('ready', () => {
    if (failing) logger.log('connection recovered');
    failing = false;
  });
  return client;
}

/** Closes both clients AFTER the HTTP server has stopped (onApplicationShutdown runs after Nest's dispose). */
@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() can hang on a stalled server (the queue client never gives up on commands): bound it, then force.
    await Promise.allSettled(
      [this.cache, this.queue].map((c) =>
        withTimeout(c.quit(), QUIT_TIMEOUT_MS).catch(() => c.disconnect()),
      ),
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: () =>
        createClient('cache', process.env.REDIS_CACHE_URL as string, CACHE_REDIS_OPTIONS),
    },
    {
      provide: REDIS_QUEUE,
      useFactory: () =>
        createClient('queue', process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS),
    },
    RedisShutdown,
  ],
  exports: [REDIS_CACHE, REDIS_QUEUE],
})
export class RedisModule {}
