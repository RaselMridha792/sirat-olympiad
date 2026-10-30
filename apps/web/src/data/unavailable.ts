import type { DataSource } from './source';

/**
 * Production source until the HTTP source lands: the mock is never served in production
 * (owner rule), so every call fails and the page shows its error state.
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
    updateProfile: fail,
    listExams: fail,
    listAnnouncements: fail,
    getAmbassador: fail,
  },
  leaderboard: { get: fail },
  admin: {
    getStats: fail,
    listUsers: fail,
    getUser: fail,
    getLeaderboard: fail,
    listExams: fail,
    getExam: fail,
    listAmbassadors: fail,
    listAnnouncements: fail,
  },
};
