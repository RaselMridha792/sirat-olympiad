import type { DataSource } from './source';

/**
 * The HTTP source's fallback for every method no area file implements yet (data/http/index.ts):
 * the mock is never served in production (owner rule), so such a call fails and the page shows
 * its error state.
 */
export class DataSourceUnavailableError extends Error {
  constructor() {
    super('Dashboard data source is not connected yet');
    this.name = 'DataSourceUnavailableError';
  }
}

const fail = async (): Promise<never> => {
  throw new DataSourceUnavailableError();
};

export const unavailableSource: DataSource = {
  kind: 'unavailable',
  student: {
    getHome: fail,
    getProfile: fail,
    getProfileOptions: fail,
    listExams: fail,
    getExam: fail,
    getReview: fail,
    listAnnouncements: fail,
    getAmbassador: fail,
    getMyTeam: fail,
    getMyRound: fail,
    getBook: fail,
    getBookOrder: fail,
  },
  leaderboard: { get: fail },
  admin: {
    getStats: fail,
    listUsers: fail,
    getUser: fail,
    getLeaderboard: fail,
    listExams: fail,
    getExam: fail,
    getExamResults: fail,
    getExamPreview: fail,
    listAttempts: fail,
    getAttempt: fail,
    listAmbassadors: fail,
    getAmbassadorPoints: fail,
    listTasks: fail,
    listTaskReviews: fail,
    listTeams: fail,
    getTeam: fail,
    listRounds: fail,
    getRoundJury: fail,
    listJuryRounds: fail,
    listJuryEntries: fail,
    listAnnouncements: fail,
    listPayments: fail,
    getPayment: fail,
    listSettings: fail,
    getBook: fail,
    listBookOrders: fail,
    listAudit: fail,
    getAuditEntry: fail,
  },
};
