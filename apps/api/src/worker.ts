import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from './common/logging/pino-http.options';
import { validateWorkerEnv } from './config/env';
import { ExamWorkerModule } from './modules/attempts/attempts.module';
import { NotificationsWorkerModule } from './modules/notifications/notifications.module';
import { PaymentsWorkerModule } from './modules/payments/payments.module';

/**
 * Queue workers (02-SYSTEM-DESIGN): same image as the API, separate `worker` service, so job load never slows the
 * HTTP path. No HTTP server apart from the container health endpoint. Today: email, the exam engine and payment checks.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateWorkerEnv }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions() }),
    NotificationsWorkerModule,
    ExamWorkerModule,
    PaymentsWorkerModule,
  ],
})
export class WorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // SIGTERM: let jobs in progress finish, then close the connections
}

void bootstrap();
