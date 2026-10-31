import type {
  AdminAmbassadorRow,
  AdminExamCard,
  AdminAttemptDetail,
  AdminAttemptQuery,
  AdminAttemptRow,
  AdminExamView,
  AdminExamQuery,
  AdminExamLeaderboard,
  AdminPaymentDetail,
  AdminPaymentQuery,
  AdminPaymentRow,
  AdminSetting,
  AdminStats,
  AdminUserDetail,
  AdminUserQuery,
  AdminUserRow,
  AmbassadorOverview,
  AnnouncementItem,
  ExamLeaderboard,
  ExamResultsStatus,
  LeaderboardQuery,
  PageQuery,
  Paginated,
  ProfileOptions,
  ProfileUpdate,
  ProfileUpdateResult,
  ReviewView,
  StudentExamListItem,
  StudentExamDetail,
  StudentHome,
  StudentProfile,
} from '@sirat/shared';

/**
 * Everything the dashboards read, behind one interface. Pages call `getData()` (server side only):
 * the HTTP source (data/http, the API with the session cookie) in production, the dev-only mock
 * source in development. Swapping sources never touches a page. No method takes a user id: the API
 * takes the acting user from the session (RULEBOOK §18). Planned endpoints are noted per method; the
 * full map is in docs/07-UI-MIGRATION.md.
 */
export interface DataSource {
  readonly kind: 'mock' | 'unavailable' | 'http';
  student: {
    /** GET /dashboard/home */
    getHome(): Promise<StudentHome>;
    /** GET /users/me */
    getProfile(): Promise<StudentProfile>;
    /** GET /content/profile-options (grade table + configured education types) */
    getProfileOptions(): Promise<ProfileOptions>;
    /** PATCH /users/me (allow-list DTO) */
    updateProfile(input: ProfileUpdate): Promise<ProfileUpdateResult>;
    /** GET /exams (state decided by the server clock; resultsPublished opens the review) */
    listExams(): Promise<StudentExamListItem[]>;
    /** GET /exams/:id: the waiting room (never questions); null = not found or not visible to this student */
    getExam(id: string): Promise<StudentExamDetail | null>;
    /**
     * GET /attempts/:id/review: the student's own attempt with the correct options, explanations, score and rank,
     * only after the exam's results are published; null = not found, not theirs, or not published yet
     */
    getReview(attemptId: string): Promise<ReviewView | null>;
    /** GET /announcements */
    listAnnouncements(query: PageQuery): Promise<Paginated<AnnouncementItem>>;
    /** GET /ambassador/me (role ambassador) */
    getAmbassador(): Promise<AmbassadorOverview>;
  };
  leaderboard: {
    /** GET /leaderboard?exam=&page=&q= (one exam's snapshot; rank, name, institution; search by name/institution) */
    get(query: LeaderboardQuery): Promise<ExamLeaderboard>;
  };
  admin: {
    /** GET /admin/stats (cached aggregate) */
    getStats(): Promise<AdminStats>;
    /** GET /admin/users?page=&q=&role=&blocked= */
    listUsers(query: AdminUserQuery): Promise<Paginated<AdminUserRow>>;
    /** GET /admin/users/:id (null = not found) */
    getUser(id: string): Promise<AdminUserDetail | null>;
    /** GET /admin/leaderboard?exam=&page=&q= (with emails, scores and times, also before publishing) */
    getLeaderboard(query: LeaderboardQuery): Promise<AdminExamLeaderboard>;
    /** GET /admin/exams?page=&q=&status= */
    listExams(query: AdminExamQuery): Promise<Paginated<AdminExamCard>>;
    /** GET /admin/exams/:id (with questions, correct keys and the `updatedAt` write token; null = not found) */
    getExam(id: string): Promise<AdminExamView | null>;
    /** GET /admin/exams/:id/results (counts, snapshot, what can be built or published; null = not found) */
    getExamResults(id: string): Promise<ExamResultsStatus | null>;
    /** GET /admin/exams/:id/attempts?status=&endReason=&minViolations=&q=&page= (owner Q4: violations) */
    listAttempts(examId: string, query: AdminAttemptQuery): Promise<Paginated<AdminAttemptRow>>;
    /** GET /admin/exams/:id/attempts/:attemptId (with the events and their times; null = not found) */
    getAttempt(examId: string, attemptId: string): Promise<AdminAttemptDetail | null>;
    /** GET /admin/ambassadors?page=&q= */
    listAmbassadors(query: PageQuery): Promise<Paginated<AdminAmbassadorRow>>;
    /** GET /admin/announcements?page= */
    listAnnouncements(query: PageQuery): Promise<Paginated<AnnouncementItem>>;
    /** GET /admin/payments?invoice=&trx=&phone=&email=&status=&review=1&page= (admin only) */
    listPayments(query: AdminPaymentQuery): Promise<Paginated<AdminPaymentRow>>;
    /** GET /admin/payments/:id, with its events (null = not found) */
    getPayment(id: string): Promise<AdminPaymentDetail | null>;
    /** GET /admin/settings (the keys an admin may change) */
    listSettings(): Promise<AdminSetting[]>;
  };
}
