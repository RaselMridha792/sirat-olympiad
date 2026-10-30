import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Runs after Nest has closed the HTTP server and drained in-flight requests (SIGTERM), then closes the pool. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
