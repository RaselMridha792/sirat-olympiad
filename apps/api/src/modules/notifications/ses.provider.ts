import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import {
  EMAIL_SEND_TIMEOUT_MS,
  type EmailMessage,
  type EmailProvider,
  PermanentEmailError,
} from './email.types';

/**
 * SES errors after which the same request can never succeed. Everything else (throttling, daily quota, a paused or
 * suspended account, an unverified MAIL FROM domain, service and network errors) is retried by the queue, so mail
 * goes out once the operator has fixed the account.
 */
const PERMANENT_ERRORS = new Set(['MessageRejected', 'BadRequestException', 'NotFoundException']);

export interface SesCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Explicit credentials from our validated env: the SDK never falls back to ~/.aws, instance metadata or other
 * AWS_* variables. One attempt per call; retries belong to the queue (one retry layer, with its backoff).
 */
export function createSesClient({
  region,
  accessKeyId,
  secretAccessKey,
}: SesCredentials): SESv2Client {
  return new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
}

/**
 * Production provider (owner, 2026-10-31: Amazon SES). SESv2 SendEmail; the IAM user may only call ses:SendEmail
 * (RUNBOOK §9). SES has no idempotency key: the job id prevents duplicate jobs, and a resend after a lost response
 * is possible but rare. Errors carry the SES error name only, never the credentials, address or content.
 */
export class SesProvider implements EmailProvider {
  readonly name = 'ses';

  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const utf8 = (data: string) => ({ Data: data, Charset: 'UTF-8' });
    const input: SendEmailCommandInput = {
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: utf8(message.subject),
          Body: { Text: utf8(message.text), ...(message.html ? { Html: utf8(message.html) } : {}) },
        },
      },
    };
    try {
      await this.client.send(new SendEmailCommand(input), {
        abortSignal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error && /^[A-Za-z]{1,64}$/.test(e.name) ? e.name : 'UnknownError';
      if (PERMANENT_ERRORS.has(name)) throw new PermanentEmailError(`SES answered ${name}`);
      throw new Error(`SES answered ${name}`);
    }
  }
}
