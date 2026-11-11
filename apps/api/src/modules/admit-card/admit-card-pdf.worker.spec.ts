import type { ConfigService } from '@nestjs/config';
import type { AdmitCard } from '@sirat/shared';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import * as renderer from './admit-card-pdf';
import { AdmitCardPdfWorker } from './admit-card-pdf.worker';
import type { AdmitCardService } from './admit-card.service';

const card = { participantId: 'ON00000000001', name: 'Worker Spec' } as AdmitCard;
const SECRET = 'ON 4821 0937 552 and a library message';

function worker(forUser: () => Promise<AdmitCard>, cache: Partial<Redis> = {}) {
  return new AdmitCardPdfWorker(
    { forUser } as unknown as AdmitCardService,
    cache as Redis,
    { get: () => undefined } as unknown as ConfigService<EnvVars, true>,
  );
}
const job = { id: 'spec', name: 'render', data: { userId: 'u', locale: 'bn' as const } };

describe("AdmitCardPdfWorker errors (exam's review of #45)", () => {
  afterEach(() => jest.restoreAllMocks());

  it('rethrows a render error with its name only, so BullMQ never keeps the message for 7 days', async () => {
    class FontkitError extends Error {
      override name = 'FontkitError';
    }
    jest.spyOn(renderer, 'renderAdmitCardPdf').mockRejectedValue(new FontkitError(SECRET));
    const failure = await worker(async () => card)
      .process(job)
      .catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('admit card render failed: FontkitError');
    expect(String((failure as Error).stack)).not.toContain(SECRET);
  });

  it('does the same for a database or cache error', async () => {
    const dbError = Object.assign(new Error(SECRET), { name: 'PrismaClientKnownRequestError' });
    await expect(
      worker(async () => {
        throw dbError;
      }).process(job),
    ).rejects.toThrow(/^admit card render failed: PrismaClientKnownRequestError$/);

    jest.spyOn(renderer, 'renderAdmitCardPdf').mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const multi = {
      hset: () => multi,
      expire: () => multi,
      exec: async () => [[new Error(SECRET), null]],
    };
    await expect(
      worker(async () => card, { multi: () => multi } as unknown as Partial<Redis>).process(job),
    ).rejects.toThrow(/^admit card render failed: Error$/);
  });
});
