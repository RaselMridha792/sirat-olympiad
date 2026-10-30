import type {
  AdminAmbassadorRow,
  AdminExamCard,
  AdminExamDetail,
  AdminExamQuery,
  AdminLeaderboardQuery,
  AdminLeaderboardView,
  AdminStats,
  AdminUserDetail,
  AdminUserQuery,
  AdminUserRow,
  AmbassadorOverview,
  AnnouncementItem,
  LeaderboardQuery,
  LeaderboardRow,
  LeaderboardView,
  PageQuery,
  Paginated,
  ProfileOptions,
  ProfileUpdate,
  ProfileUpdateResult,
  StudentExamCard,
  StudentHome,
  StudentProfile,
} from '@sirat/shared';

/**
 * Everything the dashboards read, behind one interface. Pages call `getData()` (server side only);
 * today it returns the dev-only mock source, later an HTTP source that calls the API with the
 * session cookie. Swapping sources never touches a page. No method takes a user id: the API takes
 * the acting user from the session (RULEBOOK §18). Planned endpoints are noted per method; the
 * full map is in docs/07-UI-MIGRATION.md.
 */
export interface DataSource {
  readonly kind: 'mock' | 'unavailable';
  student: {
    /** GET /dashboard/home */
    getHome(): Promise<StudentHome>;
    /** GET /users/me */
    getProfile(): Promise<StudentProfile>;
    /** GET /content/profile-options (grade table + configured education types) */
    getProfileOptions(): Promise<ProfileOptions>;
    /** PATCH /users/me (allow-list DTO) */
    updateProfile(input: ProfileUpdate): Promise<ProfileUpdateResult>;
    /** GET /exams (state decided by the server clock) */
    listExams(): Promise<StudentExamCard[]>;
    /** GET /announcements */
    listAnnouncements(query: PageQuery): Promise<Paginated<AnnouncementItem>>;
    /** GET /ambassador/me (role ambassador) */
    getAmbassador(): Promise<AmbassadorOverview>;
  };
  leaderboard: {
    /** GET /leaderboard?round=&page=&q= (precomputed snapshot; search by name/institution only) */
    get(query: LeaderboardQuery): Promise<LeaderboardView<LeaderboardRow>>;
  };
  admin: {
    /** GET /admin/stats (cached aggregate) */
    getStats(): Promise<AdminStats>;
    /** GET /admin/users?page=&q=&role=&blocked= */
    listUsers(query: AdminUserQuery): Promise<Paginated<AdminUserRow>>;
    /** GET /admin/users/:id (null = not found) */
    getUser(id: string): Promise<AdminUserDetail | null>;
    /** GET /admin/leaderboard?round=&page=&q=&category= */
    getLeaderboard(query: AdminLeaderboardQuery): Promise<AdminLeaderboardView>;
    /** GET /admin/exams?page=&q=&status= */
    listExams(query: AdminExamQuery): Promise<Paginated<AdminExamCard>>;
    /** GET /admin/exams/:id (with questions and correct keys; null = not found) */
    getExam(id: string): Promise<AdminExamDetail | null>;
    /** GET /admin/ambassadors?page=&q= */
    listAmbassadors(query: PageQuery): Promise<Paginated<AdminAmbassadorRow>>;
    /** GET /admin/announcements?page= */
    listAnnouncements(query: PageQuery): Promise<Paginated<AnnouncementItem>>;
  };
}
