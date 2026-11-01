import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** The role this connection logs in as (current_user) and whether it is a superuser. */
export async function describeDatabaseRole(
  db: PrismaClient,
): Promise<{ name: string; superuser: boolean }> {
  const [row] = await db.$queryRaw<{ name: string; superuser: boolean }[]>`
    SELECT current_user AS "name", r.rolsuper AS "superuser" FROM pg_roles r WHERE r.rolname = current_user`;
  return { name: row?.name ?? 'unknown', superuser: row?.superuser ?? false };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // One boot line, like the PayStation one, so RUNBOOK §9's "runtime role" item can be read from the logs.
    const role = await describeDatabaseRole(this);
    this.logger.log(`database role=${role.name} superuser=${role.superuser}`);
    if (role.superuser && process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'the API connects to Postgres as a superuser; production should use sirat_app (OPEN-QUESTIONS #27, LAUNCH-PLAN L8)',
      );
    }
  }

  /** Runs after Nest has closed the HTTP server and drained in-flight requests (SIGTERM), then closes the pool. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
