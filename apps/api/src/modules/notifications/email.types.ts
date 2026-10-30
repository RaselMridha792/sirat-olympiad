/** One email. Rendered by the caller; the queue and providers never inspect or log it. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailJobData {
  kind: string; // e.g. verify-email, password-reset
  message: EmailMessage;
}

/** Sends one email. `idempotencyKey` is the job id (Mailpit shows it as a header; SES has no idempotency keys). */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage, idempotencyKey: string): Promise<void>;
}

/** The request can never succeed (rejected address, bad key...): the job fails at once instead of retrying. */
export class PermanentEmailError extends Error {
  override name = 'PermanentEmailError';
}

export const EMAIL_QUEUE = 'email';
/** Injection token for the queue name (tests use their own queue). */
export const EMAIL_QUEUE_NAME = Symbol('EMAIL_QUEUE_NAME');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Each provider call gives up after this long; the job is then retried. */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;
