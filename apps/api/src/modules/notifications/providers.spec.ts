import { PermanentEmailError } from './email.types';
import { MailpitProvider, parseSender } from './mailpit.provider';
import { ResendProvider } from './resend.provider';

const KEY = `re_live_${'a1B2'.repeat(8)}`;
const ADDRESS = 'student@example.com';
const message = { to: ADDRESS, subject: 'Verify', text: 'Open https://x.test/verify?t=TOKEN' };

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}
const failing = (error: Error) =>
  (async () => {
    throw error;
  }) as unknown as typeof fetch;

describe('ResendProvider', () => {
  it('posts the documented request: Bearer key, User-Agent, Idempotency-Key and the JSON body', async () => {
    const { fn, calls } = fakeFetch(200, { id: 'abc' });
    await new ResendProvider(KEY, 'Sirat <no-reply@sirat.test>', fn).send(
      message,
      'verify-email.1',
    );
    const { url, init } = calls[0] ?? { url: '', init: {} };
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'verify-email.1',
      'User-Agent': expect.stringMatching(/\S/),
    });
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Sirat <no-reply@sirat.test>',
      to: [ADDRESS],
      subject: 'Verify',
      text: message.text,
    });
  });

  it.each([400, 401, 403, 422])(
    'treats %i as permanent, with no key, address or content in the error',
    async (status) => {
      const { fn } = fakeFetch(status, { name: 'validation_error', message: `bad ${ADDRESS}` });
      const err = await new ResendProvider(KEY, 'a@b.co', fn).send(message, 'k').catch((e) => e);
      expect(err).toBeInstanceOf(PermanentEmailError);
      expect(err.message).toBe(`Resend answered ${status} (validation_error)`);
      for (const secret of [KEY, ADDRESS, 'TOKEN']) expect(err.message).not.toContain(secret);
    },
  );

  it.each([429, 500, 503])('retries %i', async (status) => {
    const err = await new ResendProvider(KEY, 'a@b.co', fakeFetch(status).fn)
      .send(message, 'k')
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentEmailError);
  });

  it('retries a 409 for a request still in progress, but not a key reused with another body', async () => {
    const busy = fakeFetch(409, { name: 'concurrent_idempotent_requests' }).fn;
    const reused = fakeFetch(409, { name: 'invalid_idempotent_request' }).fn;
    expect(
      await new ResendProvider(KEY, 'a@b.co', busy).send(message, 'k').catch((e) => e),
    ).not.toBeInstanceOf(PermanentEmailError);
    expect(
      await new ResendProvider(KEY, 'a@b.co', reused).send(message, 'k').catch((e) => e),
    ).toBeInstanceOf(PermanentEmailError);
  });

  it('retries network errors and timeouts', async () => {
    const err = await new ResendProvider(KEY, 'a@b.co', failing(new TypeError('fetch failed')))
      .send(message, 'k')
      .catch((e) => e);
    expect(err).not.toBeInstanceOf(PermanentEmailError);
  });
});

describe('MailpitProvider', () => {
  it("posts Mailpit's send API shape, with the idempotency key as a header", async () => {
    const { fn, calls } = fakeFetch(200, { ID: 'x' });
    await new MailpitProvider('http://mailpit:8025', 'Sirat <no-reply@sirat.test>', fn).send(
      message,
      'verify-email.1',
    );
    expect(calls[0]?.url).toBe('http://mailpit:8025/api/v1/send');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      From: { Name: 'Sirat', Email: 'no-reply@sirat.test' },
      To: [{ Email: ADDRESS }],
      Subject: 'Verify',
      Text: message.text,
      Headers: { 'X-Idempotency-Key': 'verify-email.1' },
    });
  });

  it('treats 400 as permanent and retries anything else', async () => {
    const bad = await new MailpitProvider('http://m', 'a@b.co', fakeFetch(400).fn)
      .send(message, 'k')
      .catch((e) => e);
    const down = await new MailpitProvider('http://m', 'a@b.co', fakeFetch(502).fn)
      .send(message, 'k')
      .catch((e) => e);
    expect(bad).toBeInstanceOf(PermanentEmailError);
    expect(down).not.toBeInstanceOf(PermanentEmailError);
  });

  it('parses both sender forms', () => {
    expect(parseSender('Sirat Olympiad <no-reply@sirat.test>')).toEqual({
      Name: 'Sirat Olympiad',
      Email: 'no-reply@sirat.test',
    });
    expect(parseSender('no-reply@sirat.test')).toEqual({ Email: 'no-reply@sirat.test' });
  });
});
