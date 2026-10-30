import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { DrainService } from './common/shutdown/drain.service';

/**
 * The HTTP pipeline, shared by main.ts and the integration tests so the tests exercise the production setup.
 * Order matters: the drain middleware must stay first.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1); // behind Nginx/Cloudflare; real IPs only from trusted proxy headers
  app.use(app.get(DrainService).middleware()); // first: `Connection: close` on every response while draining
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
