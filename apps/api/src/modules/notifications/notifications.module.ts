import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env';
import { EmailQueue } from './email-queue.service';
import { EMAIL_PROVIDER, type EmailProvider } from './email.types';
import { EmailWorker } from './email.worker';
import { MailpitProvider } from './mailpit.provider';
import { SesProvider, createSesClient } from './ses.provider';
import { WorkerHealthService } from './worker-health.service';

/** API side: other modules call EmailQueue.enqueue(). Sending happens only in the worker. */
@Module({ providers: [EmailQueue], exports: [EmailQueue] })
export class NotificationsModule {}

/** The provider the worker sends with (validateWorkerEnv has already checked the configuration). */
export function createEmailProvider(config: ConfigService<EnvVars, true>): EmailProvider {
  const from = config.get('EMAIL_FROM', { infer: true }) ?? '';
  const provider = config.get('EMAIL_PROVIDER', { infer: true });
  if (provider === 'ses')
    return new SesProvider(
      createSesClient({
        region: config.get('SES_REGION', { infer: true }) ?? '',
        accessKeyId: config.get('SES_ACCESS_KEY_ID', { infer: true }) ?? '',
        secretAccessKey: config.get('SES_SECRET_ACCESS_KEY', { infer: true }) ?? '',
      }),
      from,
    );
  return new MailpitProvider(config.get('MAILPIT_URL', { infer: true }) ?? '', from);
}

/** Worker side (worker.ts): the email worker, its provider and the container health endpoint. */
@Module({
  providers: [
    { provide: EMAIL_PROVIDER, inject: [ConfigService], useFactory: createEmailProvider },
    EmailWorker,
    WorkerHealthService,
  ],
})
export class NotificationsWorkerModule {}
