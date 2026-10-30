import { PermanentEmailError } from './email.types';
import { MailpitProvider, parseSender } from './mailpit.provider';

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
