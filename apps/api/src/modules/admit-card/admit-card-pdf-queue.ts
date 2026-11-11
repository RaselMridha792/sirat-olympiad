import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { AdmitCard, AdmitCardPdfLocale } from '@sirat/shared';
import type { JobsOptions } from 'bullmq';
import type { EnvVars } from '../../config/env';

/** The admit card PDF on the queue Redis (core A2): the API asks, the worker renders into the cache Redis. */
export const ADMIT_CARD_PDF_QUEUE = 'admit-card-pdf';
/** ADMIT_CARD_PDF_QUEUE, or ADMIT_CARD_PDF_QUEUE_NAME (tests give each run its own, as for the other queues). */
export const admitCardPdfQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('ADMIT_CARD_PDF_QUEUE_NAME', { infer: true }) || ADMIT_CARD_PDF_QUEUE;

export const ADMIT_CARD_PDF_JOB = 'render';

/**
 * The layout's version, part of a file's version (below): bump it with any change to admit-card-pdf.ts or its texts,
 * so a file made by the older layout is never served after a deploy. Kept here, so the API never loads the renderer.
 */
export const ADMIT_CARD_PDF_LAYOUT = 1;

/** Ids only: the worker reads the card itself, so no personal data and never the participant ID reaches Redis jobs. */
export interface AdmitCardPdfJobData {
  userId: string;
  locale: AdmitCardPdfLocale;
}

/**
 * 3 tries, 2 s apart and doubling (the student is waiting on the page); a failed job is kept 7 days, so ops-check
 * sees it. A re-run is safe: it renders the current card again and overwrites the same key with the same bytes.
 */
export const ADMIT_CARD_PDF_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
};

/** How long a rendered file stays in the cache Redis: long enough to download, short for a file with the full ID. */
export const ADMIT_CARD_PDF_TTL_SECONDS = 600;

/**
 * One cache-Redis hash per user and language, so a student holds at most one file per language: field `v` is the
 * version it was made from, field `pdf` the bytes.
 */
export const admitCardPdfKey = (userId: string, locale: AdmitCardPdfLocale): string =>
  `admit-card-pdf:v1:${userId}:${locale}`;

/**
 * The version of the file a card makes: a hash of everything printed (the card, the language and the layout). The
 * API serves a cached file only when its version matches the card as it is now, so an edit (a corrected name, an
 * exam date) is never answered with an old print. The participant ID is left out of the hash, so nothing derived
 * from the login secret is stored or logged (an ID never changes once issued; the registration date is in the hash).
 */
export function admitCardPdfVersion(card: AdmitCard, locale: AdmitCardPdfLocale): string {
  // JSON.stringify leaves out undefined values.
  const printed = { ...card, participantId: undefined, participantIdMasked: undefined };
  return createHash('sha256')
    .update(JSON.stringify({ layout: ADMIT_CARD_PDF_LAYOUT, locale, card: printed }))
    .digest('hex')
    .slice(0, 32);
}

/**
 * The job's id: one job per user, language and minute, so a double click or a polling page queues one render. A
 * failed job keeps its id for 7 days (ops-check); asking again the next minute queues a fresh one.
 */
export const admitCardPdfJobId = (data: AdmitCardPdfJobData, now: Date): string =>
  `admit-card-pdf.${data.userId}.${data.locale}.${Math.floor(now.getTime() / 60_000)}`;
