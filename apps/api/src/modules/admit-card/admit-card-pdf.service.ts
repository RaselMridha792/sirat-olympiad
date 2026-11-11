import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AdmitCardPdfLocale, AdmitCardPdfStatus } from '@sirat/shared';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import { REDIS_CACHE } from '../../redis/redis.module';
import { admitCardPdfKey, admitCardPdfVersion } from './admit-card-pdf-queue';
import { AdmitCardPdfQueue } from './admit-card-pdf.queue';
import { AdmitCardService } from './admit-card.service';

const CACHE_TIMEOUT_MS = 2_000;

/**
 * The admit card PDF, API side (core A2; 06-API "Admit card"). The caller's own card only (the user comes from the
 * session, re-read by AdmitCardService before anything is queued or served). The worker renders it; the file waits
 * in the cache Redis for 3 minutes under the card's version, and a file is served only while the card still matches
 * that version.
 */
@Injectable()
export class AdmitCardPdfService {
  private readonly logger = new Logger(AdmitCardPdfService.name);

  constructor(
    private readonly admitCard: AdmitCardService,
    private readonly queue: AdmitCardPdfQueue,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  /** `ready` when the file for the card as it is now is waiting; otherwise queues the render (`pending`). */
  async request(userId: string, locale: AdmitCardPdfLocale): Promise<AdmitCardPdfStatus> {
    const card = await this.admitCard.forUser(userId);
    const cached = await this.cached(userId, locale);
    if (cached?.version === admitCardPdfVersion(card, locale)) return { status: 'ready' };
    if (!(await this.queue.render({ userId, locale })))
      throw new ServiceUnavailableException(['pdf_unavailable']);
    return { status: 'pending' };
  }

  /**
   * The file, or 404 pdf_not_ready (not made yet, expired, or made from details that have changed since). The page
   * polls this: while there is no file (the key is the session user's own), it answers without a database read; a
   * file is served only after the account and the card are re-read and match its version (exam's review of #45).
   */
  async file(userId: string, locale: AdmitCardPdfLocale): Promise<Buffer> {
    const cached = await this.cached(userId, locale);
    if (!cached) throw new NotFoundException(['pdf_not_ready']);
    const card = await this.admitCard.forUser(userId);
    if (cached.version !== admitCardPdfVersion(card, locale))
      throw new NotFoundException(['pdf_not_ready']);
    return cached.pdf;
  }

  private async cached(
    userId: string,
    locale: AdmitCardPdfLocale,
  ): Promise<{ version: string; pdf: Buffer } | null> {
    let fields: Array<Buffer | null>;
    try {
      fields = await withTimeout(
        this.cache.hmgetBuffer(admitCardPdfKey(userId, locale), 'v', 'pdf'),
        CACHE_TIMEOUT_MS,
      );
    } catch (e) {
      this.logger.error({ msg: 'admit card pdf: cache Redis unavailable', ...errorLogFields(e) });
      throw new ServiceUnavailableException(['pdf_unavailable']);
    }
    const [version, pdf] = fields;
    return version && pdf ? { version: version.toString('latin1'), pdf } : null;
  }
}
