import {
  EXAM_VIOLATION_WARNINGS,
  type AdminLeaderboardRow,
  type AdminUserDetail,
  type AdminUserRow,
  type AmbassadorOverview,
  type AnnouncementItem,
  type AdminAttemptDetail,
  type AdminAttemptRow,
  type AdminExamLeaderboard,
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
import { withLeakCanaries } from './leak.ts';
import { emptyPage, matches, paginate } from './paging.ts';

/**
 * DEV-ONLY data source. Behaves like the planned API: server-side paging and search, the server
 * clock decides exam states, students never get scores, emails or correct answers.
 * The marker lets scripts/assert-no-mock.mjs prove this module is absent from production builds.
 */
export const MOCK_SOURCE_MARKER = 'SIRAT_MOCK_DATA_SOURCE';
const SLOW_MS = 2000;

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
            };
          },
          () => ({
            user: { name: getWorld().me.name, category: null },
            currentRound: null,
            nextExam: null,
            latestAnnouncements: [],
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

      updateProfile: (input) =>
        run(
          () => {
            const me = getWorld().me;
            Object.assign(me, input);
            me.category = gradeOf(input.gradeLevelId)?.category ?? me.category; // derived on the server
            return { ok: true as const };
          },
          () => ({ ok: true as const }),
        ),

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
              approvedAt: mine?.approvedAt ?? null,
              referralCount: mine?.referralCount ?? 0,
              points,
              rank: {
                current: current ? { name: current.name, minPoints: current.minPoints } : null,
                next: next ? { name: next.name, minPoints: next.minPoints } : null,
              },
              team: { ...w.team, isOwner: true },
              tasks: w.tasks.map(({ id, title, description, points: p, status }) => ({
                id,
                title,
                description,
                points: p,
                status,
              })),
              recentReferrals: w.users
                .filter((u) => u.referredById === w.me.id)
                .slice(0, 10)
                .map(({ name, institution, createdAt }) => ({ name, institution, createdAt })),
            };
          },
          (): AmbassadorOverview => ({
            promoCode: null,
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
            const count = (status: 'paid' | 'pending') =>
              w.users.filter((u) => u.payment?.status === status).length;
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
                })),
              query,
            ),
          () => emptyPage(query),
        ),

      listAnnouncements: (query) =>
        run(
          () => paginate(announcementItems(getWorld()), query),
          () => emptyPage<AnnouncementItem>(query),
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
