import {
  EMAIL_SEND_TIMEOUT_MS,
  type EmailMessage,
  type EmailProvider,
  PermanentEmailError,
} from './email.types';

/** `Name <address>` or a bare address, as Mailpit's send API wants it. */
export function parseSender(from: string): { Email: string; Name?: string } {
  const match = /^(.+?)\s*<([^<>]+)>$/.exec(from.trim());
  return match?.[1] && match[2]
    ? { Name: match[1].trim(), Email: match[2] }
    : { Email: from.trim() };
}

/**
 * Development provider: Mailpit's HTTP send API (POST /api/v1/send). Nothing leaves the machine; every email is
 * visible in the Mailpit UI. The idempotency key travels as a header so tests and humans can see it.
 */
export class MailpitProvider implements EmailProvider {
  readonly name = 'mailpit';
  private readonly sender: { Email: string; Name?: string };

  constructor(
    private readonly baseUrl: string,
    from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.sender = parseSender(from);
  }

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    const res = await this.fetchFn(new URL('/api/v1/send', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: this.sender,
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        ...(message.html ? { HTML: message.html } : {}),
        Headers: { 'X-Idempotency-Key': idempotencyKey },
      }),
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });
    if (res.ok) return;
    const detail = `Mailpit answered ${res.status}`;
    if (res.status === 400) throw new PermanentEmailError(detail);
    throw new Error(detail);
  }
}
