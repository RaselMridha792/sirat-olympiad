import {
  ADMIN_AUDIT_EXPORT,
  CATEGORIES,
  dammDigit,
  maskParticipantId,
  DEFAULT_VIDEO_CRITERIA,
  type AdminDiscountCode,
  type AdminRound,
  type AdminCertificateRow,
  type JuryEntryRow,
  BD_DISTRICTS,
  type AdminAnnouncement,
  type AdminTaskReviewRow,
  type AdminTeamRow,
  type AdminTaskRow,
  EXAM_VIOLATION_WARNINGS,
  type AdminLeaderboardRow,
  BOOK_COVER_LIMITS,
  type AdminBookInfo,
  type AdminDemoStatus,
  type AdminBookOrderRow,
  type AdminPaymentDetail,
  type AdminPaymentRow,
  type AdminSetting,
  type BookInfo,
  type MyBookOrder,
  type MyBookOrderView,
  type AdminUserDetail,
  type AdminUserRow,
  type AdmitCard,
  type AmbassadorLeaderboard,
  type AmbassadorOverview,
  type AnnouncementItem,
  type AdminAttemptDetail,
  type AdminAttemptRow,
  type AdminExamLeaderboard,
  type AdminExamPreview,
  type AdminExamView,
  type ExamEvent,
  type ExamResultsStatus,
  type ExamLeaderboard,
  type ExamLeaderboardExam,
  type LeaderboardRow,
  type ProfileOptions,
  type ReviewView,
  type StudentExamListItem,
  type StudentExamDetail,
  type StudentExamState,
  type StudentProfile,
} from '@sirat/shared';
import { mockDiscountCode, mockDiscountCodes, mockDiscountCodeUses } from './discount-codes.ts';
import type { MockState } from '../mode';
import type { DataSource } from '../source';
import {
  EDUCATION_TYPES,
  getWorld,
  GRADE_LEVELS,
  RANKS,
  type MockExam,
  type MockStanding,
  type MockUser,
  type MockWorld,
} from './fixtures.ts';
import { auditMatches, mockAudit } from './audit.ts';
import { withLeakCanaries } from './leak.ts';
import { emptyPage, matches, paginate } from './paging.ts';

/**
 * DEV-ONLY data source. Behaves like the planned API: server-side paging and search, the server
 * clock decides exam states, students never get scores, emails or correct answers.
 * The marker lets scripts/assert-no-mock.mjs prove this module is absent from production builds.
 */
export const MOCK_SOURCE_MARKER = 'SIRAT_MOCK_DATA_SOURCE';
const SLOW_MS = 2000;
/** A valid participant ID for the mock student (the real one is drawn by the database). */
const MOCK_PARTICIPANT_ID = `ON4821093755${dammDigit('4821093755')}`;

const gradeOf = (id: string | null) => GRADE_LEVELS.find((g) => g.id === id) ?? null;

function examState(exam: MockExam, now: number): StudentExamState {
  if (exam.myAttempt === 'submitted' || exam.myAttempt === 'scored') return 'submitted';
  const start = Date.parse(exam.windowStart);
  const end = Date.parse(exam.windowEnd);
  if (now < start) return 'upcoming';
  if (now > end) return 'closed';
  return exam.myAttempt === 'in_progress' ? 'in_progress' : 'open';
}

const STATE_ORDER: Record<StudentExamState, number> = {
  in_progress: 0,
  open: 1,
  upcoming: 2,
  submitted: 3,
  closed: 4,
};

function studentExams(w: MockWorld): Array<StudentExamListItem & { graceSeconds: number }> {
  const now = Date.now();
  return w.exams
    .filter((e) => e.status !== 'draft' && (e.category === null || e.category === w.me.category))
    .map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      durationMinutes: e.durationMinutes,
      questionsPerAttempt: e.questionsPerAttempt,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      graceSeconds: e.graceSeconds,
      state: examState(e, now),
      resultsPublished: e.resultsPublishedAt !== null,
    }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.windowStart.localeCompare(b.windowStart),
    );
}

const announcementItems = (w: MockWorld): AnnouncementItem[] =>
  [...w.announcements]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map(({ id, title, body, publishedAt }) => ({ id, title, body, publishedAt }));

/** The exam a leaderboard shows, as the API picks it: the requested one, else the latest that qualifies. */
function leaderboardExam(
  w: MockWorld,
  examId: string | undefined,
  qualifies: (exam: MockExam) => boolean,
): MockExam | null {
  if (examId) return w.exams.find((e) => e.id === examId && e.status !== 'draft') ?? null;
  return (
    w.exams.filter(qualifies).sort((a, b) => b.windowEnd.localeCompare(a.windowEnd))[0] ?? null
  );
}

const examInfo = ({ id, title, category }: MockExam): ExamLeaderboardExam => ({
  id,
  title,
  category,
});

/**
 * An exam's snapshot here: its round's standings, its category's participants only, ranked again within the exam
 * (score down, time up; equal score and time share a rank: 1, 2, 2, 4), as the real snapshot ranks each exam.
 */
function examStandings(w: MockWorld, exam: MockExam): MockStanding[] {
  const inExam = (exam.roundId ? (w.standings.get(exam.roundId) ?? []) : []).filter(
    (s) => exam.category === null || s.user.category === exam.category,
  );
  return inExam.map((s, i) => {
    let first = i;
    while (
      first > 0 &&
      inExam[first - 1]!.score === s.score &&
      inExam[first - 1]!.timeTakenSeconds === s.timeTakenSeconds
    )
      first -= 1;
    return { ...s, rank: first + 1 };
  });
}

/** A snapshot exists once the window has closed and someone has a result. */
const hasSnapshot = (w: MockWorld, exam: MockExam) =>
  Date.parse(exam.windowEnd) < Date.now() && examStandings(w, exam).length > 0;

/**
 * The attempts of an exam here: one per participant of its snapshot. A fixed pattern ends some by time and some by
 * violations (owner Q4: the 6th violation submits), so every filter and the events dialog have something to show.
 */
function examAttempts(w: MockWorld, exam: MockExam): AdminAttemptDetail[] {
  const opens = Date.parse(exam.windowStart);
  return examStandings(w, exam).map((s, i) => {
    const byViolations = i % 13 === 4;
    const byTime = !byViolations && i % 9 === 2;
    const violationCount = byViolations ? EXAM_VIOLATION_WARNINGS + 1 : i % 4;
    const startedAt = opens + (i % 50) * 60_000;
    const taken = s.timeTakenSeconds ?? exam.durationMinutes * 60;
    const events: ExamEvent[] = [];
    for (let k = 0; k < violationCount; k++) {
      const at = 60 + k * 90;
      if (k % 3 === 2) events.push({ type: 'devtools', at });
      else events.push({ type: 'leave', at }, { type: 'return', at: at + 15 });
    }
    return {
      attemptId: `att-${exam.id}-${s.user.id}`,
      userId: s.user.id,
      name: s.user.name,
      email: s.user.email,
      status: 'scored',
      endReason: byViolations ? 'violations' : byTime ? 'time_up' : 'submitted',
      violationCount,
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(startedAt + exam.durationMinutes * 60_000).toISOString(),
      submittedAt: new Date(startedAt + taken * 1000).toISOString(),
      timeTakenSeconds: taken,
      score: s.score,
      events,
    };
  });
}

const userRow = (u: MockUser): AdminUserRow => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  isBlocked: u.isBlocked,
  category: u.category,
  district: u.district,
  createdAt: u.createdAt,
  phoneLast3: u.phone ? u.phone.slice(-3) : null,
  gradeLabel: gradeOf(u.gradeLevelId)?.label ?? null,
  emailVerified: u.emailVerifiedAt !== null,
  // A registration exists only for a paid payment (payments' trigger), so only those carry one here.
  registration:
    u.payment?.status === 'paid'
      ? {
          registeredAt: u.payment.paidAt ?? u.createdAt,
          invoiceNumber: u.payment.invoiceNumber,
          paymentStatus: u.payment.status,
          paidAt: u.payment.paidAt,
        }
      : null,
  needsPaymentReview: false,
});

/** Payments as the admin list shows them: one per mock user who reached a checkout (amounts are mock values). */
const MOCK_ACCOUNT = 'mock-sandbox';
const paymentRows = (w: MockWorld): AdminPaymentRow[] =>
  w.users.flatMap((u, i): AdminPaymentRow[] => {
    const p = u.payment;
    if (!p) return [];
    const paid = p.status === 'paid';
    const started = Date.parse(u.createdAt);
    // A few rows carry review reasons, so the review filter and its badges have something to show.
    const reviewReason =
      paid && i % 97 === 5
        ? 'late_success'
        : !paid && i % 89 === 7
          ? 'success_without_trx_id'
          : null;
    return [
      {
        id: `pay-${u.id}`,
        invoiceNumber: p.invoiceNumber,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        trxId: paid ? `TRX-${p.invoiceNumber}` : null,
        paidAmountMinor: paid ? p.amountMinor : null,
        gatewayStatus: paid ? 'success' : p.status === 'failed' ? 'failed' : 'processing',
        gatewayAccount: MOCK_ACCOUNT,
        reviewReason,
        checkCount: paid ? 1 : 3,
        lastCheckedAt: new Date(started + 5 * 60_000).toISOString(),
        expiresAt: new Date(started + 60 * 60_000).toISOString(),
        paidAt: p.paidAt,
        createdAt: u.createdAt,
        userId: paid ? u.id : null,
        attempt: {
          status: paid ? 'completed' : 'open',
          email: u.email,
          phone: u.phone ?? '01700000000',
          name: u.name,
        },
      },
    ];
  });

const MOCK_BOOK_TITLE = 'Leadership for Tomorrow (mock)';

/** A confirmed (or shipped) order for a mock user: their name and phone, a district from their profile. */
const mockBookOrder = (u: MockUser, shipped = false): MyBookOrderView => ({
  status: shipped ? 'shipped' : 'confirmed',
  recipientName: u.name,
  recipientPhone: u.phone ?? '01700000000',
  district: u.district ?? 'Dhaka',
  upazila: 'Mirpur',
  addressLine: 'House 12, Road 3, Block C',
  note: null,
  bookTitle: MOCK_BOOK_TITLE,
  version: 1,
  confirmedAt: u.createdAt,
  shippedAt: shipped ? u.createdAt : null,
});

const MOCK_SETTINGS: AdminSetting[] = [
  { key: 'payment_expiry_minutes', value: 60, updatedAt: '2026-10-31T00:00:00.000Z' },
  { key: 'registration_closes_at', value: null, updatedAt: '2026-10-31T00:00:00.000Z' },
  { key: 'registration_fee_minor', value: 40000, updatedAt: '2026-10-31T00:00:00.000Z' },
  { key: 'registration_open', value: true, updatedAt: '2026-10-31T00:00:00.000Z' },
  { key: 'registration_opens_at', value: null, updatedAt: '2026-10-31T00:00:00.000Z' },
];

export function createMockSource(state: MockState | null): DataSource {
  const run = async <T>(full: () => T, empty: () => T): Promise<T> => {
    if (state === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    if (state === 'error')
      throw new Error(`${MOCK_SOURCE_MARKER}: simulated failure (?mock=error)`);
    return state === 'empty' ? empty() : full();
  };

  const profileOptions = (): ProfileOptions => ({
    gradeLevels: GRADE_LEVELS.map(({ id, label, category }) => ({ id, label, category })),
    educationTypes: [...EDUCATION_TYPES],
    districts: [...BD_DISTRICTS],
  });

  const source: DataSource = {
    kind: 'mock',
    student: {
      getHome: () =>
        run(
          () => {
            const w = getWorld();
            const exams = studentExams(w);
            const round = w.rounds.find((r) => r.id === w.currentRoundId);
            return {
              user: { name: w.me.name, category: w.me.category },
              currentRound: round
                ? {
                    id: round.id,
                    name: round.name,
                    type: round.type,
                    sortOrder: round.sortOrder,
                    entryStatus: 'pending' as const,
                  }
                : null,
              nextExam:
                exams.find(
                  (e) => e.state === 'in_progress' || e.state === 'open' || e.state === 'upcoming',
                ) ?? null,
              latestAnnouncements: announcementItems(w).slice(0, 3),
              registration: w.me.payment
                ? {
                    registered: true as const,
                    registeredAt: w.me.payment.paidAt ?? w.me.createdAt,
                    participantId: MOCK_PARTICIPANT_ID,
                    category: w.me.category,
                    gradeLevel: gradeOf(w.me.gradeLevelId)?.label ?? null,
                    payment: { ...w.me.payment },
                  }
                : { registered: false as const },
            };
          },
          () => ({
            user: { name: getWorld().me.name, category: null },
            currentRound: null,
            nextExam: null,
            latestAnnouncements: [],
            registration: { registered: false as const },
          }),
        ),

      getProfile: () =>
        run(
          (): StudentProfile => {
            const w = getWorld();
            const grade = gradeOf(w.me.gradeLevelId);
            const round = w.rounds.find((r) => r.id === w.currentRoundId);
            return {
              name: w.me.name,
              email: w.me.email,
              phone: w.me.phone,
              district: w.me.district,
              institution: w.me.institution,
              educationType: w.me.educationType,
              category: w.me.category,
              role: w.me.role,
              emailVerifiedAt: w.me.emailVerifiedAt,
              createdAt: w.me.createdAt,
              gradeLevel: grade ? { id: grade.id, label: grade.label } : null,
              currentRound: round ? { id: round.id, name: round.name } : null,
            };
          },
          (): StudentProfile => {
            const { name, email, role, createdAt } = getWorld().me;
            return {
              name,
              email,
              role,
              createdAt,
              phone: null,
              district: null,
              institution: null,
              educationType: null,
              category: null,
              emailVerifiedAt: null,
              gradeLevel: null,
              currentRound: null,
            };
          },
        ),

      getProfileOptions: () => run(profileOptions, profileOptions),

      listExams: () =>
        run(
          () =>
            studentExams(getWorld()).map(
              ({
                id,
                title,
                category,
                durationMinutes,
                questionsPerAttempt,
                windowStart,
                windowEnd,
                state,
                resultsPublished,
              }) => ({
                id,
                title,
                category,
                durationMinutes,
                questionsPerAttempt,
                windowStart,
                windowEnd,
                state,
                resultsPublished,
              }),
            ),
          () => [],
        ),

      getExam: (id) =>
        run(
          (): StudentExamDetail | null => {
            const exam = studentExams(getWorld()).find((e) => e.id === id);
            if (!exam) return null;
            const now = Date.now();
            const attempt: StudentExamDetail['attempt'] =
              exam.state === 'submitted'
                ? {
                    attemptId: `att-${exam.id}`,
                    phase: 'submitted',
                    endsAt: exam.windowEnd,
                    receipt: {
                      receiptId: `00000000-0000-4000-8000-${exam.id
                        .replace(/[^0-9a-f]/g, '0')
                        .padEnd(12, '0')
                        .slice(0, 12)}`,
                      submittedAt: exam.windowStart,
                      endReason: 'submitted',
                    },
                  }
                : exam.state === 'in_progress'
                  ? {
                      attemptId: `att-${exam.id}`,
                      phase: 'in_progress',
                      endsAt: new Date(now + exam.durationMinutes * 60_000).toISOString(),
                      receipt: null,
                    }
                  : null;
            return {
              id: exam.id,
              title: exam.title,
              category: exam.category,
              durationMinutes: exam.durationMinutes,
              questionsPerAttempt: exam.questionsPerAttempt,
              windowStart: exam.windowStart,
              windowEnd: exam.windowEnd,
              state: exam.state,
              resultsPublished: exam.resultsPublished,
              graceSeconds: exam.graceSeconds,
              violationWarnings: EXAM_VIOLATION_WARNINGS,
              serverNow: new Date(now).toISOString(),
              attempt,
            };
          },
          () => null,
        ),

      getReview: (attemptId) =>
        run(
          (): ReviewView | null => {
            const w = getWorld();
            const exam = w.exams.find((e) => `att-${e.id}` === attemptId);
            if (!exam?.resultsPublishedAt) return null;
            if (studentExams(w).find((e) => e.id === exam.id)?.state !== 'submitted') return null;
            // A fixed pattern of right, wrong and skipped answers, so every look of the page shows.
            const questions = exam.questions.map((q, i) => {
              const correct = q.options.findIndex((o) => o.key === q.correctKey);
              const chosen =
                i % 4 === 3 ? null : i % 3 === 2 ? (correct + 1) % q.options.length : correct;
              return {
                text: q.text,
                options: q.options.map((o) => o.text),
                chosen,
                correct,
                explanation: q.explanation,
              };
            });
            const mine = examStandings(w, exam).find((s) => s.user.id === w.me.id);
            return {
              attemptId,
              examId: exam.id,
              title: exam.title,
              endReason: 'submitted',
              score: questions.filter((q) => q.chosen === q.correct).length,
              questionCount: questions.length,
              rank: mine?.rank ?? null,
              timeTakenSeconds: mine?.timeTakenSeconds ?? null,
              questions,
            };
          },
          () => null,
        ),

      listAnnouncements: (query) =>
        run(
          () => paginate(announcementItems(getWorld()), query),
          () => emptyPage<AnnouncementItem>(query),
        ),

      getMyRound: () =>
        run(
          () => {
            const w = getWorld();
            const r = w.rounds.find((x) => x.id === w.currentRoundId) ?? w.rounds[0];
            return r
              ? {
                  round: {
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    sortOrder: r.sortOrder,
                    opensAt: r.opensAt,
                    closesAt: r.closesAt,
                  },
                  entryStatus: 'pending' as const,
                  videoUrl: null,
                  videoSubmittedAt: null,
                }
              : null;
          },
          () => null,
        ),

      listMyCertificates: () =>
        run(
          () => {
            const w = getWorld();
            return w.rounds.slice(0, 2).map((r, i) => ({
              id: `ct-me-${i}`,
              type: i === 0 ? ('participation' as const) : ('promotion' as const),
              round: { id: r.id, name: r.name },
              serial: `SLO-2026-${String(120 + i).padStart(6, '0')}`,
              verificationCode: i === 0 ? '3FA9C1D27B10' : '9E04B2C6A1F3',
              nameOnCertificate: w.me.name,
              issuedAt: r.closesAt ?? '2026-11-20T06:00:00.000Z',
              revoked: false,
            }));
          },
          () => [],
        ),

      getMyTeam: () =>
        run(
          () => {
            const w = getWorld();
            const isOwner = w.me.role === 'ambassador';
            return {
              id: w.team.id,
              name: w.team.name,
              memberCount: w.team.memberCount,
              isOwner,
              joinCode: isOwner ? 'TM-7K3QXD' : null,
              members: [
                w.me,
                ...w.users.filter((u) => u.role === 'student').slice(0, w.team.memberCount - 1),
              ].map((u, i) => ({
                firstName: u.name.split(' ')[0] ?? u.name,
                isOwner: isOwner && i === 0,
              })),
            };
          },
          () => null,
        ),
      getAmbassador: () =>
        run(
          (): AmbassadorOverview => {
            const w = getWorld();
            const mine = w.ambassadors.find((a) => a.user.id === w.me.id);
            const points = mine?.points ?? 0;
            const reached = RANKS.filter((r) => r.minPoints <= points);
            const current = reached.at(-1) ?? null;
            const next = RANKS.find((r) => r.minPoints > points) ?? null;
            return {
              promoCode: mine?.promoCode ?? null,
              participantIdMasked: maskParticipantId(MOCK_PARTICIPANT_ID),
              approvedAt: mine?.approvedAt ?? null,
              referralCount: mine?.referralCount ?? 0,
              points,
              rank: {
                current: current ? { name: current.name, minPoints: current.minPoints } : null,
                next: next ? { name: next.name, minPoints: next.minPoints } : null,
              },
              team: { ...w.team, isOwner: true },
              tasks: w.tasks.map(
                ({ id, title, description, points: p, status, reviewNote, submittedAt }) => ({
                  id,
                  title,
                  description,
                  points: p,
                  status,
                  reviewNote,
                  submittedAt,
                }),
              ),
              recentReferrals: w.users
                .filter((u) => u.referredById === w.me.id)
                .slice(0, 10)
                .map(({ name, institution, createdAt }) => ({ name, institution, createdAt })),
            };
          },
          (): AmbassadorOverview => ({
            promoCode: null,
            participantIdMasked: null,
            approvedAt: null,
            referralCount: 0,
            points: 0,
            // A brand-new ambassador: lowest tier, the next tier still ahead (not "top rank").
            rank: {
              current: RANKS[0] ? { name: RANKS[0].name, minPoints: RANKS[0].minPoints } : null,
              next: RANKS[1] ? { name: RANKS[1].name, minPoints: RANKS[1].minPoints } : null,
            },
            team: null,
            tasks: [],
            recentReferrals: [],
          }),
        ),

      // The demo student's own admit card, as GET /admit-card answers it; ?mock=empty is a student who has not paid.
      getAdmitCard: () =>
        run(
          (): AdmitCard | null => {
            const w = getWorld();
            if (!w.me.payment) return null;
            const now = new Date(w.now).toISOString();
            const next =
              w.exams
                .filter((e) => e.status === 'published' && e.roundId !== null && e.windowEnd > now)
                .sort((a, b) => a.windowStart.localeCompare(b.windowStart))[0] ?? null;
            return {
              participantId: MOCK_PARTICIPANT_ID,
              participantIdMasked: maskParticipantId(MOCK_PARTICIPANT_ID),
              mode: 'online',
              name: w.me.name,
              category: w.me.category,
              gradeLevel: gradeOf(w.me.gradeLevelId)?.label ?? null,
              fee: {
                amountMinor: w.me.payment.amountMinor,
                currency: w.me.payment.currency,
                paidAt: w.me.payment.paidAt,
              },
              registeredAt: w.me.payment.paidAt ?? w.me.createdAt,
              exam: next && {
                examId: next.id,
                title: next.title,
                windowStart: next.windowStart,
                windowEnd: next.windowEnd,
                durationMinutes: next.durationMinutes,
                roundName: w.rounds.find((r) => r.id === next.roundId)?.name ?? null,
              },
            };
          },
          (): AdmitCard | null => null,
        ),

      // The mock ambassadors by points (equal points share a place), as the API ranks them.
      getAmbassadorLeaderboard: (query) =>
        run(
          (): AmbassadorLeaderboard => {
            const w = getWorld();
            const sorted = [...w.ambassadors]
              .filter((a) => a.approvedAt !== null)
              .sort((a, b) => b.points - a.points || a.user.name.localeCompare(b.user.name));
            const ranked = sorted.map((a) => ({
              rank: sorted.findIndex((o) => o.points === a.points) + 1,
              name: a.user.name,
              institution: a.user.institution,
              points: a.points,
              tier: RANKS.filter((r) => r.minPoints <= a.points).at(-1)?.name ?? null,
              isMe: a.user.id === w.me.id,
            }));
            const mine = ranked.find((r) => r.isMe);
            return {
              items: ranked.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
              page: query.page,
              pageSize: query.pageSize,
              total: ranked.length,
              me: mine ? { rank: mine.rank, points: mine.points } : null,
              asOf: new Date(w.now).toISOString(),
            };
          },
          (): AmbassadorLeaderboard => ({
            items: [],
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
            me: null,
            asOf: new Date().toISOString(),
          }),
        ),

      getBook: () =>
        run(
          (): BookInfo => ({ title: MOCK_BOOK_TITLE, coverUrl: null }),
          (): BookInfo => ({ title: MOCK_BOOK_TITLE, coverUrl: null }),
        ),

      // The demo student has paid and confirmed an address; `?mock=empty` shows the form (no order yet).
      getBookOrder: () =>
        run(
          (): MyBookOrder => ({ eligible: true, order: mockBookOrder(getWorld().me) }),
          (): MyBookOrder => ({ eligible: true, order: null }),
        ),
    },

    leaderboard: {
      get: (query) =>
        run(
          (): ExamLeaderboard => {
            const w = getWorld();
            const exam = leaderboardExam(w, query.exam, (e) => e.resultsPublishedAt !== null);
            if (!exam || !exam.resultsPublishedAt) {
              return {
                ...emptyPage<LeaderboardRow>(query),
                exam: exam && examInfo(exam),
                status: 'unpublished',
                snapshotAt: null,
              };
            }
            // Students search by name or institution only (never email: no account probing).
            const rows: LeaderboardRow[] = examStandings(w, exam)
              .filter((s) => matches(s.user.name, query.q) || matches(s.user.institution, query.q))
              .map((s) => ({
                rank: s.rank,
                name: s.user.name,
                institution: s.user.institution,
                entryStatus: s.entryStatus,
              }));
            return {
              ...paginate(rows, query),
              exam: examInfo(exam),
              status: 'published',
              snapshotAt: exam.resultsPublishedAt,
            };
          },
          (): ExamLeaderboard => ({
            ...emptyPage<LeaderboardRow>(query),
            exam: null,
            status: 'unpublished',
            snapshotAt: null,
          }),
        ),
    },

    admin: {
      getStats: () =>
        run(
          () => {
            const w = getWorld();
            const count = (status: 'paid' | 'pending' | 'failed' | 'expired') =>
              w.users.filter((u) => u.payment?.status === status).length;
            const ambassadors = w.users.filter((u) => u.role === 'ambassador').length;
            const promoted =
              w.standings.get('rd-1')?.filter((s) => s.entryStatus === 'promoted').length ?? 0;
            return {
              asOf: new Date(Date.now() - 4 * 60_000).toISOString(),
              totals: {
                registered: w.users.length,
                paid: count('paid'),
                pendingPayments: count('pending'),
                activeAttempts: w.activeAttempts,
                submittedAttempts: w.standings.get('rd-1')?.length ?? 0,
                secondRound: promoted,
                finalists: w.standings.get('rd-3')?.length ?? 0,
              },
              registrationsDaily: w.registrationsDaily,
              byCategory: (['activist', 'ambassador', 'achiever'] as const).map((category) => ({
                category,
                count: w.users.filter((u) => u.category === category).length,
              })),
              registrationAttempts: {
                open: count('pending'),
                completed: count('paid'),
                abandoned: count('failed') + count('expired'),
                conflict: 0,
              },
              paymentsByStatus: {
                initiated: 0,
                pending: count('pending'),
                paid: count('paid'),
                failed: count('failed'),
                expired: count('expired'),
              },
              paymentsNeedingReview: 1,
              ambassadors: { approved: ambassadors, revoked: 1, referredStudents: 3 * ambassadors },
            };
          },
          () => ({
            asOf: new Date().toISOString(),
            totals: {
              registered: 0,
              paid: 0,
              pendingPayments: 0,
              activeAttempts: 0,
              submittedAttempts: 0,
              secondRound: 0,
              finalists: 0,
            },
            registrationsDaily: getWorld().registrationsDaily.map(({ date }) => ({
              date,
              count: 0,
            })),
            byCategory: (['activist', 'ambassador', 'achiever'] as const).map((category) => ({
              category,
              count: 0,
            })),
            registrationAttempts: { open: 0, completed: 0, abandoned: 0, conflict: 0 },
            paymentsByStatus: { initiated: 0, pending: 0, paid: 0, failed: 0, expired: 0 },
            paymentsNeedingReview: 0,
            ambassadors: { approved: 0, revoked: 0, referredStudents: 0 },
          }),
        ),

      listUsers: (query) =>
        run(
          () => {
            const rows = getWorld()
              .users.filter((u) => matches(u.name, query.q) || matches(u.email, query.q))
              .filter((u) => !query.role || u.role === query.role)
              .filter((u) => query.blocked === undefined || u.isBlocked === query.blocked)
              .filter((u) => !query.category || u.category === query.category)
              .map(userRow)
              .filter(
                (r) =>
                  query.registered === undefined || (r.registration !== null) === query.registered,
              )
              .filter((r) => query.verified === undefined || r.emailVerified === query.verified);
            return paginate(rows, query);
          },
          () => emptyPage<AdminUserRow>(query),
        ),

      getUser: (id) =>
        run(
          (): AdminUserDetail | null => {
            const user = getWorld().users.find((u) => u.id === id);
            if (!user) return null;
            const grade = gradeOf(user.gradeLevelId);
            return {
              ...userRow(user),
              phone: user.phone,
              institution: user.institution,
              educationType: user.educationType,
              emailVerifiedAt: user.emailVerifiedAt,
              gradeLevel: grade ? { id: grade.id, label: grade.label } : null,
              payment: user.payment,
              referredBy: null,
              ambassador: null,
            };
          },
          () => null,
        ),

      getLeaderboard: (query) =>
        run(
          (): AdminExamLeaderboard => {
            const w = getWorld();
            const exam = leaderboardExam(w, query.exam, (e) => hasSnapshot(w, e));
            const snapshot = exam !== null && hasSnapshot(w, exam);
            const rows: AdminLeaderboardRow[] = (snapshot ? examStandings(w, exam) : [])
              .filter(
                (s) =>
                  matches(s.user.name, query.q) ||
                  matches(s.user.email, query.q) ||
                  matches(s.user.institution, query.q),
              )
              .map((s) => ({
                rank: s.rank,
                name: s.user.name,
                institution: s.user.institution,
                entryStatus: s.entryStatus,
                userId: s.user.id,
                email: s.user.email,
                category: s.user.category,
                score: s.score,
                timeTakenSeconds: s.timeTakenSeconds,
              }));
            return {
              ...paginate(rows, query),
              exam: exam && examInfo(exam),
              isPublic: exam?.resultsPublishedAt != null,
              snapshotAt: snapshot ? (exam.resultsPublishedAt ?? exam.windowEnd) : null,
              generation: snapshot ? 1 : 0,
            };
          },
          (): AdminExamLeaderboard => ({
            ...emptyPage<AdminLeaderboardRow>(query),
            exam: null,
            isPublic: false,
            snapshotAt: null,
            generation: 0,
          }),
        ),

      listExams: (query) =>
        run(
          () =>
            paginate(
              getWorld()
                .exams.filter((e) => matches(e.title, query.q))
                .filter((e) => !query.status || e.status === query.status)
                .map((e) => ({
                  id: e.id,
                  title: e.title,
                  category: e.category,
                  status: e.status,
                  durationMinutes: e.durationMinutes,
                  questionsPerAttempt: e.questionsPerAttempt,
                  windowStart: e.windowStart,
                  windowEnd: e.windowEnd,
                  questionCount: e.questions.length,
                  locked: e.status !== 'draft' && Date.parse(e.windowStart) < Date.now(),
                })),
              query,
            ),
          () => emptyPage(query),
        ),

      getExam: (id) =>
        run(
          (): AdminExamView | null => {
            const w = getWorld();
            const e = w.exams.find((x) => x.id === id);
            if (!e) return null;
            const round = w.rounds.find((r) => r.id === e.roundId);
            return {
              id: e.id,
              title: e.title,
              category: e.category,
              status: e.status,
              durationMinutes: e.durationMinutes,
              questionsPerAttempt: e.questionsPerAttempt,
              windowStart: e.windowStart,
              windowEnd: e.windowEnd,
              graceSeconds: e.graceSeconds,
              resultsPublishedAt: e.resultsPublishedAt,
              questionCount: e.questions.length,
              locked: e.status !== 'draft',
              round: round ? { id: round.id, name: round.name } : null,
              roundId: e.roundId,
              randomDraw: false,
              contentVersion: 1,
              publishedAt: e.status === 'draft' ? null : e.createdAt,
              updatedAt: e.createdAt,
              questions: e.questions.map((q, position) => ({
                id: q.id,
                lineageId: q.id,
                version: q.version,
                position,
                text: q.text,
                options: q.options,
                correctKey: q.correctKey,
                explanation: q.explanation,
                keepOptionOrder: false,
                isActive: q.isActive,
                deactivatedAt: null,
                createdAt: e.createdAt,
                updatedAt: e.createdAt,
              })),
              keyCorrections: [],
            };
          },
          () => null,
        ),

      getExamPreview: (id) =>
        run(
          (): AdminExamPreview | null => {
            const e = getWorld().exams.find((x) => x.id === id);
            if (!e) return null;
            // The mock draws nothing: the active questions in their stored order, options as written.
            const questions = e.questions.filter((q) => q.isActive).slice(0, e.questionsPerAttempt);
            return {
              examId: e.id,
              title: e.title,
              status: e.status,
              durationMinutes: e.durationMinutes,
              questionsPerAttempt: e.questionsPerAttempt,
              violationWarnings: EXAM_VIOLATION_WARNINGS,
              questions: questions.map((q) => ({
                text: q.text,
                options: q.options.map((o) => o.text),
              })),
              correct: questions.map((q) => q.options.findIndex((o) => o.key === q.correctKey)),
            };
          },
          () => null,
        ),

      getExamResults: (id) =>
        run(
          (): ExamResultsStatus | null => {
            const w = getWorld();
            const e = w.exams.find((x) => x.id === id);
            if (!e) return null;
            const closed = Date.parse(e.windowEnd) + e.graceSeconds * 1000 < Date.now();
            const snapshot = hasSnapshot(w, e);
            const open = e.status === 'published' && closed && e.resultsPublishedAt === null;
            return {
              examId: e.id,
              windowClosed: closed,
              counts: {
                in_progress: 0,
                submitted: 0,
                expired: 0,
                scored: examAttempts(w, e).length,
              },
              snapshotAt: snapshot ? (e.resultsPublishedAt ?? e.windowEnd) : null,
              generation: snapshot ? 1 : 0,
              publishedAt: e.resultsPublishedAt,
              canBuild: open,
              canPublish: open && snapshot,
              keyCorrectedAt: null,
              rescorePending: 0,
              snapshotStale: false,
              lastCorrection: null,
            };
          },
          () => null,
        ),

      listAttempts: (examId, query) =>
        run(
          () => {
            const w = getWorld();
            const e = w.exams.find((x) => x.id === examId);
            const rows: AdminAttemptRow[] = (e ? examAttempts(w, e) : [])
              .filter((a) => !query.status || a.status === query.status)
              .filter((a) => !query.endReason || a.endReason === query.endReason)
              .filter((a) => !query.minViolations || (a.violationCount ?? 0) >= query.minViolations)
              .filter((a) => matches(a.name, query.q) || matches(a.email, query.q))
              .map(({ events: _events, ...row }) => row);
            return paginate(rows, query);
          },
          () => emptyPage<AdminAttemptRow>(query),
        ),

      getAttempt: (examId, attemptId) =>
        run(
          () => {
            const w = getWorld();
            const e = w.exams.find((x) => x.id === examId);
            return (e && examAttempts(w, e).find((a) => a.attemptId === attemptId)) ?? null;
          },
          () => null,
        ),

      getRoundJury: (id) =>
        run(
          () => {
            const w = getWorld();
            const round = w.rounds.find((r) => r.id === id && r.type === 'video');
            if (!round) return null;
            const judges = w.users.filter((u) => u.role === 'jury').slice(0, 3);
            return {
              round: { id: round.id, name: round.name, demo: false },
              assignments: judges.slice(0, 2).flatMap((u, i) =>
                (i === 0 ? CATEGORIES : (['activist'] as const)).map((category) => ({
                  id: `ja-${u.id}-${category}`,
                  judge: { userId: u.id, name: u.name, email: u.email },
                  category,
                  createdAt: round.opensAt ?? '2026-10-01T00:00:00.000Z',
                })),
              ),
              candidates: judges.map((u) => ({ userId: u.id, name: u.name, email: u.email })),
            };
          },
          () => null,
        ),

      listJuryRounds: () =>
        run(
          () =>
            getWorld()
              .rounds.filter((r) => r.type === 'video')
              .map((r) => ({
                id: r.id,
                name: r.name,
                closesAt: r.closesAt,
                scoringOpen: true,
                criteria: DEFAULT_VIDEO_CRITERIA.map((c) => ({ ...c })),
                categories: [...CATEGORIES],
                pending: 12,
                evaluated: 5,
              })),
          () => [],
        ),

      listJuryEntries: (query) =>
        run(
          () => {
            const scored = query.status === 'evaluated';
            const rows = Array.from({ length: scored ? 5 : 12 }, (_, i) => ({
              entryId: `00000000-0000-7000-8000-${String(i + (scored ? 100 : 0)).padStart(12, '0')}`,
              code: `E-${(0x3fa9c1d2 + i * 7919 + (scored ? 99 : 0)).toString(16).toUpperCase().slice(-8)}`,
              category: CATEGORIES[i % CATEGORIES.length]!,
              videoUrl: `https://youtu.be/mock${i}`,
              videoSubmittedAt: `2026-11-1${i % 9}T08:00:00.000Z`,
              myScore: scored
                ? {
                    criteria: Object.fromEntries(
                      DEFAULT_VIDEO_CRITERIA.map((c) => [c.key, 6 + (i % 4)]),
                    ),
                    total: (6 + (i % 4)) * 10,
                    comment: i === 0 ? 'Clear message, good sound.' : null,
                    scoredAt: '2026-11-20T10:00:00.000Z',
                  }
                : null,
            }));
            return paginate(rows, query);
          },
          () => emptyPage<JuryEntryRow>(query),
        ),

      listCertificates: (query) =>
        run(
          () => {
            const w = getWorld();
            const rows: AdminCertificateRow[] = w.users
              .filter((u) => u.role === 'student')
              .slice(0, 30)
              .map((u, i) => ({
                id: `ct-${i}`,
                user: { userId: u.id, name: u.name, email: u.email },
                type: i < 24 ? 'participation' : i < 29 ? 'promotion' : 'winner',
                round: { id: w.rounds[i < 24 ? 0 : 1]!.id, name: w.rounds[i < 24 ? 0 : 1]!.name },
                serial: `SLO-2026-${String(i + 1).padStart(6, '0')}`,
                nameOnCertificate: u.name,
                issuedAt: '2026-11-20T06:00:00.000Z',
                revokedAt: i === 3 ? '2026-11-21T06:00:00.000Z' : null,
                revokeReason: i === 3 ? 'Issued by mistake' : null,
                updatedAt: '2026-11-20T06:00:00.000Z',
                demo: false,
              }));
            return paginate(rows, query);
          },
          () => emptyPage<AdminCertificateRow>(query),
        ),

      listRounds: () =>
        run(
          () =>
            getWorld().rounds.map((r, i): AdminRound => {
              const at = r.opensAt ?? '2026-10-01T00:00:00.000Z';
              return {
                ...r,
                criteria: r.type === 'video' ? DEFAULT_VIDEO_CRITERIA.map((c) => ({ ...c })) : null,
                scored: false,
                entries: {
                  pending: i === 1 ? 180 : 0,
                  submitted: i === 1 ? 64 : 0,
                  evaluated: 0,
                  promoted: i === 0 ? 246 : 0,
                  eliminated: i === 0 ? 1240 : 0,
                },
                promotions:
                  i === 0
                    ? CATEGORIES.map((category, k) => ({
                        id: `pr-${k}`,
                        category,
                        toRoundId: 'rd-2',
                        topN: 80,
                        promoted: k === 1 ? 86 : 80,
                        eliminated: 400 + k * 20,
                        createdAt: r.closesAt ?? at,
                      }))
                    : [],
                demo: false,
                createdAt: at,
                updatedAt: at,
              };
            }),
          () => [],
        ),

      listTeams: (query) =>
        run(
          () => {
            const w = getWorld();
            const rows = w.ambassadors.slice(0, 6).map((a, i) => ({
              id: `tm-${i}`,
              name: i === 0 ? w.team.name : `${a.user.name.split(' ')[0]}'s team`,
              owner: { userId: a.user.id, name: a.user.name },
              open: true,
              memberCount: i === 0 ? w.team.memberCount : 3 + (i % 5),
              demo: false,
              createdAt: a.user.createdAt,
              updatedAt: a.user.createdAt,
            }));
            return paginate(rows, query);
          },
          () => emptyPage<AdminTeamRow>(query),
        ),
      getTeam: (id) =>
        run(
          () => {
            const w = getWorld();
            const i = Number(id.replace(/^tm-/, ''));
            const a = w.ambassadors[i];
            if (!a || !/^tm-\d+$/.test(id)) return null;
            const members = [
              a.user,
              ...w.users.filter((u) => u.role === 'student').slice(i * 3, i * 3 + 3),
            ];
            return {
              id,
              name: i === 0 ? w.team.name : `${a.user.name.split(' ')[0]}'s team`,
              owner: { userId: a.user.id, name: a.user.name },
              open: true,
              memberCount: members.length,
              demo: false,
              createdAt: a.user.createdAt,
              updatedAt: a.user.createdAt,
              members: members.map((u) => ({
                userId: u.id,
                name: u.name,
                email: u.email,
                joinedAt: u.createdAt,
              })),
            };
          },
          () => null,
        ),
      listTasks: (query) =>
        run(
          () => {
            const w = getWorld();
            const rows = w.tasks
              .filter((t) =>
                query.status === 'archived' ? t.archivedAt !== null : t.archivedAt === null,
              )
              .map(
                ({
                  id,
                  title,
                  description,
                  points: p,
                  archivedAt,
                  createdAt,
                  updatedAt,
                  status,
                }) => ({
                  id,
                  title,
                  description,
                  points: p,
                  archivedAt,
                  createdAt,
                  updatedAt,
                  counts: {
                    assigned: status === 'assigned' ? 4 : 1,
                    submitted: status === 'submitted' ? 2 : 0,
                    approved: status === 'approved' ? 5 : 1,
                    rejected: status === 'rejected' ? 1 : 0,
                  },
                  demo: false,
                }),
              );
            return paginate(rows, query);
          },
          () => emptyPage<AdminTaskRow>(query),
        ),
      listTaskReviews: (query) =>
        run(
          () => {
            const w = getWorld();
            const rows = w.tasks
              .filter((t) => t.status === 'submitted')
              .flatMap((t) =>
                w.ambassadors.slice(0, 3).map((a, i) => ({
                  assignmentId: `${t.id}-${i}`,
                  taskId: t.id,
                  taskTitle: t.title,
                  points: t.points,
                  ambassador: { userId: a.user.id, name: a.user.name },
                  proof:
                    'Held the session with 32 students. Attendance photo: https://example.org/photo',
                  submittedAt: t.submittedAt ?? t.createdAt,
                  demo: false,
                })),
              );
            return paginate(rows, query);
          },
          () => emptyPage<AdminTaskReviewRow>(query),
        ),
      getAmbassadorPoints: () =>
        run(
          () => ({
            pointsPerReferral: 10,
            thresholds: [
              { name: 'Bronze', minPoints: 0 },
              { name: 'Silver', minPoints: 100 },
              { name: 'Gold', minPoints: 250 },
            ],
          }),
          () => ({ pointsPerReferral: 10, thresholds: [{ name: 'Bronze', minPoints: 0 }] }),
        ),
      listAmbassadors: (query) =>
        run(
          () =>
            paginate(
              getWorld()
                .ambassadors.filter(
                  (a) =>
                    matches(a.user.name, query.q) ||
                    matches(a.user.email, query.q) ||
                    matches(a.promoCode, query.q),
                )
                // `sort=points`: the most points first (a stable sort keeps the world's order otherwise).
                .sort((a, b) => (query.sort === 'points' ? b.points - a.points : 0))
                .map((a) => ({
                  userId: a.user.id,
                  name: a.user.name,
                  email: a.user.email,
                  promoCode: a.promoCode,
                  approvedAt: a.approvedAt,
                  createdAt: a.createdAt,
                  referralCount: a.referralCount,
                  points: a.points,
                  rankName: RANKS.filter((r) => r.minPoints <= a.points).at(-1)?.name ?? null,
                  demo: false,
                })),
              query,
            ),
          () => emptyPage(query),
        ),

      listAnnouncements: (query) =>
        run(
          () =>
            paginate(
              [...getWorld().announcements]
                .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
                .map((a): AdminAnnouncement => ({
                  id: a.id,
                  title: a.title,
                  body: a.body,
                  category: a.category,
                  publishedAt: a.publishedAt,
                  archivedAt: a.archivedAt,
                  createdAt: a.createdAt,
                  updatedAt: a.updatedAt,
                  status: a.archivedAt ? 'archived' : 'published',
                  authorName: 'Demo Admin',
                }))
                .filter((a) => !query.status || a.status === query.status),
              query,
            ),
          () => emptyPage<AdminAnnouncement>(query),
        ),

      listPayments: (query) =>
        run(
          () =>
            paginate(
              paymentRows(getWorld())
                .filter((p) => !query.invoice || p.invoiceNumber === query.invoice)
                .filter((p) => !query.trx || p.trxId === query.trx)
                .filter((p) => !query.phone || p.attempt.phone === query.phone)
                .filter(
                  (p) =>
                    !query.email || p.attempt.email.toLowerCase() === query.email.toLowerCase(),
                )
                .filter((p) => !query.status || p.status === query.status)
                .filter((p) => !query.review || p.reviewReason !== null)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
              query,
            ),
          () => emptyPage<AdminPaymentRow>(query),
        ),

      getPayment: (id) =>
        run(
          (): AdminPaymentDetail | null => {
            const payment = paymentRows(getWorld()).find((p) => p.id === id);
            if (!payment) return null;
            const at = (minutes: number) =>
              new Date(Date.parse(payment.createdAt) + minutes * 60_000).toISOString();
            const event = (
              n: number,
              source: string,
              outcome: string,
              trxStatus: string | null,
            ) => ({
              id: `${payment.id}-ev${n}`,
              source,
              outcome,
              statusCode: source === 'initiate' || source === 'status_v1' ? '200' : null,
              trxStatus,
              trxId: trxStatus === 'success' ? payment.trxId : null,
              byAdmin: false,
              createdAt: at(n),
            });
            const events =
              payment.status === 'paid'
                ? [
                    event(3, 'status_v1', 'applied_paid', 'success'),
                    event(2, 'callback', 'verify_requested', 'successful'),
                    event(0, 'initiate', 'checkout_created', null),
                  ]
                : [
                    event(
                      2,
                      'status_v1',
                      payment.status === 'failed' ? 'applied_failed' : 'no_change',
                      payment.gatewayStatus,
                    ),
                    event(0, 'initiate', 'checkout_created', null),
                  ];
            return { payment, events };
          },
          () => null,
        ),

      listSettings: () =>
        run(
          () => MOCK_SETTINGS.map((s) => ({ ...s })),
          () => MOCK_SETTINGS.map((s) => ({ ...s })),
        ),

      listDiscountCodes: (query) =>
        run(
          () => mockDiscountCodes(query),
          () => emptyPage<AdminDiscountCode>(query),
        ),

      getDiscountCode: (id) =>
        run(
          () => mockDiscountCode(id),
          () => null,
        ),

      listDiscountCodeUses: (id, query) =>
        run(
          () => mockDiscountCodeUses(id, query),
          () => null,
        ),

      getDemoStatus: () =>
        run(
          (): AdminDemoStatus => ({
            allowed: true,
            batch: null,
            progress: null,
            lastOutcome: null,
          }),
          (): AdminDemoStatus => ({
            allowed: false,
            batch: null,
            progress: null,
            lastOutcome: null,
          }),
        ),

      getBook: () =>
        run(
          (): AdminBookInfo => ({ title: MOCK_BOOK_TITLE, cover: null, limits: BOOK_COVER_LIMITS }),
          (): AdminBookInfo => ({ title: MOCK_BOOK_TITLE, cover: null, limits: BOOK_COVER_LIMITS }),
        ),

      listBookOrders: (query) =>
        run(
          () =>
            paginate(
              getWorld()
                .users.filter((u) => u.payment?.status === 'paid')
                .map((u, i): AdminBookOrderRow => ({
                  ...mockBookOrder(u, i % 4 === 0),
                  id: `bko-${u.id}`,
                  code: `B${String(1_000_000_000 + i).slice(-10)}`,
                  student: { name: u.name, email: u.email, phone: u.phone },
                }))
                .filter((o) => !query.status || o.status === query.status)
                .filter((o) => !query.district || o.district === query.district)
                .filter(
                  (o) =>
                    !query.phone ||
                    o.recipientPhone === query.phone ||
                    o.student.phone === query.phone,
                )
                .filter(
                  (o) =>
                    !query.email || o.student.email.toLowerCase() === query.email.toLowerCase(),
                ),
              query,
            ),
          () => emptyPage<AdminBookOrderRow>(query),
        ),

      listAudit: (query) =>
        run(
          () => {
            const rows = mockAudit(getWorld().users).filter((r) => auditMatches(r, query));
            const start = query.before ? Number(query.before.replace(/^m/, '')) || 0 : 0;
            const limit = query.limit ?? ADMIN_AUDIT_EXPORT.pageSize;
            const items = rows
              .slice(start, start + limit)
              .map(({ detail: _detail, ...row }) => row);
            return { items, next: start + limit < rows.length ? `m${start + limit}` : null };
          },
          () => ({ items: [], next: null }),
        ),
      getAuditEntry: (id) =>
        run(
          () => {
            const row = mockAudit(getWorld().users).find((r) => r.id === id);
            if (!row) return null;
            const { detail, ...rest } = row;
            return { ...rest, ...detail };
          },
          () => null,
        ),
    },
  };
  return state === 'leak' ? withStudentLeaks(source) : source;
}

/**
 * ?mock=leak: every student-facing response also carries fields its type does not have (scores,
 * times, other people's emails, answer keys). Pages must render none of them; scripts/check-pages.mjs
 * fetches the rendered HTML (including the inline RSC payload) and fails if a canary shows up.
 */
function withStudentLeaks(source: DataSource): DataSource {
  const leaky =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> =>
      withLeakCanaries(await fn(...args));
  const student = Object.fromEntries(
    Object.entries(source.student).map(([name, fn]) => [name, leaky(fn as () => Promise<unknown>)]),
  ) as unknown as DataSource['student'];
  return { ...source, student, leaderboard: { get: leaky(source.leaderboard.get) } };
}
