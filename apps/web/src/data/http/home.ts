import {
  PAYMENT_STATUSES,
  type MyRegistration,
  type StudentExamListItem,
  type StudentHome,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { studentAnnouncements } from './announcements.ts';
import { studentExams } from './exams.ts';
import { studentProfile } from './profile.ts';
import { getJson, isRecord, type ApiGet } from './request.ts';

/*
 * The student's home (core C4; core plan D6): composed on the server from existing endpoints, so no team's module
 * changes for it. GET /users/me (name, category), GET /exams and GET /exams/:id (the next exam with its grace),
 * GET /announcements (the latest 3) and payments' GET /registrations/me. Rounds come with core C6.
 */

const text = (v: unknown): v is string => typeof v === 'string';

function isMyRegistration(v: unknown): v is MyRegistration {
  if (!isRecord(v)) return false;
  if (v.registered === false) return true;
  const p = v.payment;
  return (
    v.registered === true &&
    text(v.registeredAt) &&
    isRecord(p) &&
    text(p.invoiceNumber) &&
    Number.isInteger(p.amountMinor) &&
    text(p.currency) &&
    (PAYMENT_STATUSES as readonly unknown[]).includes(p.status) &&
    (p.paidAt === null || text(p.paidAt))
  );
}

const pickRegistration = (r: MyRegistration): MyRegistration =>
  r.registered
    ? {
        registered: true,
        registeredAt: r.registeredAt,
        payment: {
          invoiceNumber: r.payment.invoiceNumber,
          amountMinor: r.payment.amountMinor,
          currency: r.payment.currency,
          status: r.payment.status,
          paidAt: r.payment.paidAt,
        },
      }
    : { registered: false };

/** The exam the home shows: one in progress, else one open now, else the next upcoming (earliest window). Pure. */
export function pickNextExam(exams: StudentExamListItem[]): StudentExamListItem | null {
  const byStart = (a: StudentExamListItem, b: StudentExamListItem) =>
    a.windowStart.localeCompare(b.windowStart);
  for (const state of ['in_progress', 'open', 'upcoming'] as const) {
    const found = exams.filter((e) => e.state === state).sort(byStart)[0];
    if (found) return found;
  }
  return null;
}

export function studentHome(get: ApiGet): Pick<DataSource['student'], 'getHome'> {
  const profile = studentProfile(get);
  const exams = studentExams(get);
  const announcements = studentAnnouncements(get);
  return {
    async getHome(): Promise<StudentHome> {
      const [me, list, latest, registration] = await Promise.all([
        profile.getProfile(),
        exams.listExams(),
        announcements.listAnnouncements({ page: 1, pageSize: 3 }),
        getJson(get, '/registrations/me', isMyRegistration),
      ]);
      const next = pickNextExam(list);
      const detail = next ? await exams.getExam(next.id) : null;
      return {
        user: { name: me.name, category: me.category },
        currentRound: null,
        nextExam:
          next && detail
            ? {
                id: next.id,
                title: next.title,
                category: next.category,
                durationMinutes: next.durationMinutes,
                questionsPerAttempt: next.questionsPerAttempt,
                windowStart: next.windowStart,
                windowEnd: next.windowEnd,
                state: next.state,
                graceSeconds: detail.graceSeconds,
              }
            : null,
        latestAnnouncements: latest.items,
        registration: pickRegistration(registration),
      };
    },
  };
}
