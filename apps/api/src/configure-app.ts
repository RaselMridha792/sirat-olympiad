import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutInterceptor,
} from './common/request-timeout.interceptor';
import { DrainService } from './common/shutdown/drain.service';

export interface ConfigureAppOptions {
  /** Only tests change this, to prove the timeout is wired without waiting 25 s. */
  requestTimeoutMs?: number;
}

/**
 * The HTTP pipeline, shared by main.ts and the integration tests so the tests exercise the production setup.
 * Order matters: the drain middleware must stay first.
 */
export function configureApp(app: NestExpressApplication, options: ConfigureAppOptions = {}): void {
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1); // behind Nginx/Cloudflare; real IPs only from trusted proxy headers
  app.use(app.get(DrainService).middleware()); // first: `Connection: close` on every response while draining
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(
    new RequestTimeoutInterceptor(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
