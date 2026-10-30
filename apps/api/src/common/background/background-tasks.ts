import { Global, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { errorLogFields } from '../all-exceptions.filter';
import { withTimeout } from '../with-timeout';

/** How long shutdown waits for work still running after its response was sent. */
const SHUTDOWN_WAIT_MS = 10_000;

/**
 * Work that runs after the response: forgot-password and resend-verification (so their timing never reveals whether
 * an account exists) and security alert emails (so a login is never slowed by them). Errors are logged by class only;
 * on SIGTERM the process waits up to 10 s for work in progress.
 */
@Injectable()
export class BackgroundTasks implements OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundTasks.name);
  private readonly pending = new Set<Promise<void>>();

  run(task: string, work: () => Promise<unknown>): void {
    const done: Promise<void> = work()
      .then(() => undefined)
      .catch((e: unknown) =>
        this.logger.error({ msg: 'background task failed', task, ...errorLogFields(e) }),
      )
      .finally(() => this.pending.delete(done));
    this.pending.add(done);
  }

  /** Resolves once the work started so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await withTimeout(this.idle(), SHUTDOWN_WAIT_MS).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [BackgroundTasks], exports: [BackgroundTasks] })
export class BackgroundModule {}
