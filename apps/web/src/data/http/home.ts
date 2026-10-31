import {
  CATEGORIES,
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
    (v.category === null || (CATEGORIES as readonly unknown[]).includes(v.category)) &&
    (v.gradeLevel === null || text(v.gradeLevel)) &&
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
        category: r.category,
        gradeLevel: r.gradeLevel,
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
      // The profile is required (the page needs the name). Every other section falls back on its own, so a
      // payments or exams hiccup never turns the whole home into the error state (lead, C5a).
      const [me, list, latest, registration] = await Promise.all([
        profile.getProfile(),
        orElse(exams.listExams(), []),
        orElse(announcements.listAnnouncements({ page: 1, pageSize: 3 }), { items: [] }),
        orElse(getJson(get, '/registrations/me', isMyRegistration), null),
      ]);
      const next = pickNextExam(list);
      const detail = next ? await orElse(exams.getExam(next.id), null) : null;
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
        registration: registration && pickRegistration(registration),
      };
    },
  };
}

/** Next's own control flow (redirect to /refresh after a 401, notFound): never swallowed by a fallback. */
const isNextControlFlow = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  'digest' in e &&
  typeof e.digest === 'string' &&
  /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK|NOT_FOUND)/.test(e.digest);

/** A section's value, or its fallback when the section fails (any error but Next's control flow). */
async function orElse<T, F>(promise: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await promise;
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    return fallback;
  }
}
