import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { PermanentEmailError } from './email.types';
import { SesProvider, createSesClient } from './ses.provider';

const ADDRESS = 'student@example.com';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const message = {
  to: ADDRESS,
  subject: 'যাচাই / Verify',
  text: 'Open https://x.test/verify?t=TOKEN',
};

function fakeClient(outcome: 'ok' | Error) {
  const sent: { command: SendEmailCommand; options: { abortSignal?: AbortSignal } }[] = [];
  return {
    sent,
    send: (async (command: SendEmailCommand, options: { abortSignal?: AbortSignal }) => {
      sent.push({ command, options });
      if (outcome !== 'ok') throw outcome;
      return { MessageId: 'm-1' };
    }) as never,
  };
}
const sesError = (name: string) =>
  Object.assign(new Error(`${name}: rejected ${ADDRESS}`), { name });

describe('SesProvider (owner: Amazon SES, SESv2)', () => {
  it('sends one SendEmail with the sender, recipient and UTF-8 subject and body, with a timeout', async () => {
    const client = fakeClient('ok');
    await new SesProvider(client, 'Sirat Olympiad <no-reply@sirat.test>').send({
      ...message,
      html: '<p>Open</p>',
    });
    expect(client.sent).toHaveLength(1);
    const { command, options } = client.sent[0] ?? ({} as never);
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: 'Sirat Olympiad <no-reply@sirat.test>',
      Destination: { ToAddresses: [ADDRESS] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: '<p>Open</p>', Charset: 'UTF-8' },
          },
        },
      },
    });
    expect(options.abortSignal).toBeDefined();
  });

  it.each(['MessageRejected', 'BadRequestException', 'NotFoundException'])(
    'treats %s as permanent, naming only the error',
    async (name) => {
      const err = await new SesProvider(fakeClient(sesError(name)), 'a@b.co')
        .send(message)
        .catch((e) => e);
      expect(err).toBeInstanceOf(PermanentEmailError);
      expect(err.message).toBe(`SES answered ${name}`);
      expect(err.message).not.toContain(ADDRESS);
    },
  );

  it.each([
    'TooManyRequestsException',
    'LimitExceededException',
    'SendingPausedException',
    'AccountSuspendedException',
    'MailFromDomainNotVerifiedException',
    'InternalServiceErrorException',
    'TimeoutError',
  ])('retries %s', async (name) => {
    const err = await new SesProvider(fakeClient(sesError(name)), 'a@b.co')
      .send(message)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentEmailError);
  });

  it('uses only the credentials it is given, with SDK retries off (the queue retries)', async () => {
    const client = createSesClient({
      region: 'ap-south-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET,
    });
    expect(await client.config.region()).toBe('ap-south-1');
    expect(await client.config.maxAttempts()).toBe(1);
    const credentials = await client.config.credentials();
    expect(credentials).toMatchObject({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET,
    });
    client.destroy();
  });
});
