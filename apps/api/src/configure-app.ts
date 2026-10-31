import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
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
  // HSTS comes from nginx only (DECISIONS "TLS behind Cloudflare"). Helmet's default (1 year, includeSubDomains)
  // would bind every subdomain of the client's domain with the first https answer, and browsers keep it.
  app.use(helmet({ strictTransportSecurity: false }));
  // No API answer is ever stored by a browser or by Cloudflare: a "cache everything" rule would otherwise hand one
  // student's /api/auth/me to the next. A route that sets its own Cache-Control (the CSV export) overrides this.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(
    new RequestTimeoutInterceptor(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
