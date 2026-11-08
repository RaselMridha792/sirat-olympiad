import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { EnvVars } from '../../config/env';
import { EmailWorker } from './email.worker';
import type { EmailJobData, EmailProvider } from './email.types';

const job = (to: string) =>
  ({
    id: 'verify-email.1',
    name: 'verify-email',
    timestamp: 0,
    data: { kind: 'verify-email', message: { to, subject: 'Verify', text: 'link' } },
  }) as unknown as Job<EmailJobData>;

describe('EmailWorker (demo data: never sends to a demo account)', () => {
  const send = jest.fn<Promise<void>, Parameters<EmailProvider['send']>>();
  const worker = new EmailWorker(
    { send } as unknown as EmailProvider,
    {} as ConfigService<EnvVars, true>,
  );
  beforeEach(() => send.mockReset().mockResolvedValue(undefined));

  it('drops a job addressed to the demo domain (any case) without calling the provider', async () => {
    await expect(worker.process(job('jury-001@Demo.Sirat.Invalid'))).resolves.toBe('dropped');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends any other address, other .invalid domains included', async () => {
    await expect(worker.process(job('student@example.com'))).resolves.toBe('sent');
    await expect(worker.process(job('a@ci.invalid'))).resolves.toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
