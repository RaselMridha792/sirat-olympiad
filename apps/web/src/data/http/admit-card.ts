import {
  CATEGORIES,
  isParticipantId,
  MASKED_PARTICIPANT_ID_PATTERN,
  maskParticipantId,
  type AdmitCard,
  type StudentNextExam,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJsonOrNull, isRecord, type ApiGet } from './request.ts';

/*
 * The admit card (core A1; 06-API "Admit card"). Every field is checked and picked by name. The participant ID must
 * be a valid canonical ID, and its masked form must be exactly the mask of that ID, so the share image can never
 * carry anything else.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';

const isExam = (v: unknown): v is StudentNextExam =>
  isRecord(v) &&
  text(v.examId) &&
  text(v.title) &&
  text(v.windowStart) &&
  text(v.windowEnd) &&
  Number.isInteger(v.durationMinutes) &&
  textOrNull(v.roundName);

const isAdmitCard = (v: unknown): v is AdmitCard =>
  isRecord(v) &&
  text(v.participantId) &&
  isParticipantId(v.participantId) &&
  text(v.participantIdMasked) &&
  MASKED_PARTICIPANT_ID_PATTERN.test(v.participantIdMasked) &&
  v.participantIdMasked === maskParticipantId(v.participantId) &&
  (v.mode === 'online' || v.mode === 'offline') &&
  text(v.name) &&
  (v.category === null || (CATEGORIES as readonly unknown[]).includes(v.category)) &&
  textOrNull(v.gradeLevel) &&
  isRecord(v.fee) &&
  Number.isInteger(v.fee.amountMinor) &&
  text(v.fee.currency) &&
  textOrNull(v.fee.paidAt) &&
  text(v.registeredAt) &&
  (v.exam === null || isExam(v.exam));

export function studentAdmitCard(get: ApiGet): Pick<DataSource['student'], 'getAdmitCard'> {
  return {
    /** GET /admit-card (student, ambassador): null without a paid registration (404 not_registered). */
    async getAdmitCard() {
      const c = await getJsonOrNull(get, '/admit-card', isAdmitCard);
      return (
        c && {
          participantId: c.participantId,
          participantIdMasked: c.participantIdMasked,
          mode: c.mode,
          name: c.name,
          category: c.category,
          gradeLevel: c.gradeLevel,
          fee: { amountMinor: c.fee.amountMinor, currency: c.fee.currency, paidAt: c.fee.paidAt },
          registeredAt: c.registeredAt,
          exam: c.exam && {
            examId: c.exam.examId,
            title: c.exam.title,
            windowStart: c.exam.windowStart,
            windowEnd: c.exam.windowEnd,
            durationMinutes: c.exam.durationMinutes,
            roundName: c.exam.roundName,
          },
        }
      );
    },
  };
}
