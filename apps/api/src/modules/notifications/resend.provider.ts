import {
  EMAIL_SEND_TIMEOUT_MS,
  type EmailMessage,
  type EmailProvider,
  PermanentEmailError,
} from './email.types';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
/** Answers after which the same request will never succeed. 429, 5xx and network errors are retried. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 405, 422]);

/**
 * Production provider (owner: Resend). Plain fetch against the documented API: Bearer key, a User-Agent (required,
 * 403 without one) and an Idempotency-Key, so a retry after a lost response does not send twice. The key is only
 * ever placed in the Authorization header: never logged, never in an error message.
 */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    const res = await this.fetchFn(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'sirat-olympiad-worker/1.0',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });
    if (res.ok) return;
    const error = await errorName(res);
    const detail = `Resend answered ${res.status}${error ? ` (${error})` : ''}`;
    // 409 is permanent only when the key was reused with another body; "request in progress" is retried.
    if (
      PERMANENT_STATUSES.has(res.status) ||
      (res.status === 409 && error === 'invalid_idempotent_request')
    )
      throw new PermanentEmailError(detail);
    throw new Error(detail);
  }
}

/** Only Resend's error name (e.g. validation_error), never its message, which can quote the request. */
async function errorName(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === 'string' && /^[a-z_]{1,64}$/.test(body.name)
      ? body.name
      : undefined;
  } catch {
    return undefined;
  }
}
