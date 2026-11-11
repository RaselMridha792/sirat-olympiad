import type { DataSource } from '../source.ts';
import { unavailableSource } from '../unavailable.ts';
import { adminExams } from './admin-exams.ts';
import { studentAdmitCard } from './admit-card.ts';
import { adminAmbassadors, studentAmbassador } from './ambassador.ts';
import { adminAudit } from './audit.ts';
import { adminAnnouncements, studentAnnouncements } from './announcements.ts';
import { adminDemo } from './demo.ts';
import { adminBook, studentBook } from './book.ts';
import { studentExams } from './exams.ts';
import { studentHome } from './home.ts';
import { adminLeaderboard, leaderboard } from './leaderboard.ts';
import { adminPayments } from './payments.ts';
import { adminDiscountCodes } from './discount-codes.ts';
import { studentProfile } from './profile.ts';
import type { ApiGet } from './request.ts';
import { adminStats } from './stats.ts';
import { adminTasks } from './tasks.ts';
import { adminCertificates, studentCertificates } from './certificates.ts';
import { adminJury } from './jury.ts';
import { adminRounds, studentRound } from './rounds.ts';
import { adminTeams, studentTeam } from './teams.ts';
import { adminUsers } from './users.ts';

/**
 * The production data source: server-side reads from the API, one file per area (DECISIONS "Web data layer over
 * HTTP"). A method no area file implements yet stays `unavailable`, so its page keeps showing the error state.
 * To connect a method: add or extend the area file and spread it into its group below. Pure (no Next imports):
 * server.ts binds `get` to the page request.
 */
export function createHttpSource(get: ApiGet): DataSource {
  return {
    kind: 'http',
    student: {
      ...unavailableSource.student,
      ...studentExams(get),
      ...studentProfile(get),
      ...studentBook(get),
      ...studentAnnouncements(get),
      ...studentHome(get),
      ...studentAmbassador(get),
      ...studentTeam(get),
      ...studentRound(get),
      ...studentCertificates(get),
      ...studentAdmitCard(get),
    },
    leaderboard: {
      ...unavailableSource.leaderboard,
      ...leaderboard(get),
    },
    admin: {
      ...unavailableSource.admin,
      ...adminLeaderboard(get),
      ...adminExams(get),
      ...adminUsers(get),
      ...adminAnnouncements(get),
      ...adminAmbassadors(get),
      ...adminPayments(get),
      ...adminDiscountCodes(get),
      ...adminDemo(get),
      ...adminBook(get),
      ...adminStats(get),
      ...adminAudit(get),
      ...adminTasks(get),
      ...adminTeams(get),
      ...adminRounds(get),
      ...adminJury(get),
      ...adminCertificates(get),
    },
  };
}
