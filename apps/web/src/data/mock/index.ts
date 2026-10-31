import {
  BD_DISTRICTS,
  EXAM_VIOLATION_WARNINGS,
  type AdminLeaderboardRow,
  type AdminUserDetail,
  type AdminUserRow,
  type AmbassadorOverview,
  type AnnouncementItem,
  type LeaderboardRound,
  type LeaderboardRow,
  type ProfileOptions,
  type StudentExamCard,
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
const pickRound = ({ id, name, type, sortOrder }: LeaderboardRound): LeaderboardRound => ({
  id,
  name,
  type,
  sortOrder,
});

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

function studentExams(w: MockWorld): Array<StudentExamCard & { graceSeconds: number }> {
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

/** Latest round with a published snapshot, else the first round. */
function resolveRound(w: MockWorld, roundId: string | undefined): LeaderboardRound | null {
  const rounds = w.rounds.map(pickRound);
  const requested = rounds.find((r) => r.id === roundId);
  if (requested) return requested;
  const published = rounds.filter((r) => w.standings.has(r.id));
  return published.at(-1) ?? rounds[0] ?? null;
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
              }) => ({
                id,
                title,
                category,
                durationMinutes,
                questionsPerAttempt,
                windowStart,
                windowEnd,
                state,
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
              resultsPublished: false,
              graceSeconds: exam.graceSeconds,
              violationWarnings: EXAM_VIOLATION_WARNINGS,
              serverNow: new Date(now).toISOString(),
              attempt,
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
          () => {
            const w = getWorld();
            const rounds = w.rounds.map(pickRound);
            const round = resolveRound(w, query.roundId);
            const standings = round ? w.standings.get(round.id) : undefined;
            if (!round || !standings || !w.leaderboardPublic) {
              return { status: 'unpublished' as const, rounds, round };
            }
            // Students search by name or institution only (never email: no account probing).
            const rows: LeaderboardRow[] = standings
              .filter((s) => matches(s.user.name, query.q) || matches(s.user.institution, query.q))
              .map((s) => ({
                rank: s.rank,
                name: s.user.name,
                institution: s.user.institution,
                entryStatus: s.entryStatus,
              }));
            return {
              status: 'published' as const,
              rounds,
              round,
              snapshotAt: w.snapshotAt,
              ...paginate(rows, query),
            };
          },
          () => {
            const w = getWorld();
            return {
              status: 'unpublished' as const,
              rounds: w.rounds.map(pickRound),
              round: resolveRound(w, query.roundId),
            };
          },
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
          () => {
            const w = getWorld();
            const round = resolveRound(w, query.roundId);
            const standings = (round && w.standings.get(round.id)) || [];
            const rows: AdminLeaderboardRow[] = standings
              .filter(
                (s) =>
                  matches(s.user.name, query.q) ||
                  matches(s.user.email, query.q) ||
                  matches(s.user.institution, query.q),
              )
              .filter((s) => !query.category || s.user.category === query.category)
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
              isPublic: w.leaderboardPublic,
              rounds: w.rounds.map(pickRound),
              round,
              snapshotAt: standings.length ? w.snapshotAt : null,
              ...paginate(rows, query),
            };
          },
          () => {
            const w = getWorld();
            return {
              isPublic: false,
              rounds: w.rounds.map(pickRound),
              round: resolveRound(w, query.roundId),
              snapshotAt: null,
              ...emptyPage<AdminLeaderboardRow>(query),
            };
          },
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
          () => {
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
              locked: e.status !== 'draft' && Date.parse(e.windowStart) < Date.now(),
              round: round ? { id: round.id, name: round.name } : null,
              questions: e.questions.map(
                ({ id: qid, text, options, correctKey, explanation, version }) => ({
                  id: qid,
                  text,
                  options,
                  correctKey,
                  explanation,
                  version,
                }),
              ),
            };
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
