import type {
  AdminCertificateQuery,
  AdminCertificateRow,
  MyCertificate,
  AdminRound,
  AdminRoundJury,
  JuryEntryQuery,
  JuryEntryRow,
  JuryRound,
  MyRound,
  AdminTeamDetail,
  AdminTeamRow,
  MyTeam,
  AdminTaskQuery,
  AdminTaskReviewRow,
  AdminTaskRow,
  AmbassadorPointsConfig,
  AdminAuditDetail,
  AdminAuditPage,
  AdminAuditQuery,
  AdminAnnouncement,
  AdminAnnouncementQuery,
  AdminAmbassadorRow,
  AdminBookInfo,
  AdminBookOrderQuery,
  AdminBookOrderRow,
  BookInfo,
  MyBookOrder,
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
    /** GET /content/profile-options (grade table, education types, districts). The save is a browser write
     *  (PATCH /users/me through lib/api.ts, components/profile/ProfileForm.tsx), so it is not in this interface. */
    getProfileOptions(): Promise<ProfileOptions>;
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
    /** GET /teams/mine (the own team, first names only; null = not in a team) */
    getMyTeam(): Promise<MyTeam | null>;
    /** GET /rounds/me (the current round and the own entry; null = there is no round at all) */
    getMyRound(): Promise<MyRound | null>;
    /** GET /certificates/mine (the own certificates, revoked ones marked) */
    listMyCertificates(): Promise<MyCertificate[]>;
    /** GET /book (the free book's title and cover) */
    getBook(): Promise<BookInfo>;
    /** GET /book-order/me (eligible, and the student's own order) */
    getBookOrder(): Promise<MyBookOrder>;
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
    /** GET /admin/ambassador-points (points per paid referral and the rank thresholds; admin only) */
    getAmbassadorPoints(): Promise<AmbassadorPointsConfig>;
    /** GET /admin/tasks?status=&page= (ambassador tasks with counts per status; admin only) */
    listTasks(query: AdminTaskQuery): Promise<Paginated<AdminTaskRow>>;
    /** GET /admin/task-assignments?page= (submitted proofs waiting for review, oldest first; admin only) */
    listTaskReviews(query: PageQuery): Promise<Paginated<AdminTaskReviewRow>>;
    /** GET /admin/teams?q=&page= (teams with owner and member count; admin only) */
    listTeams(query: PageQuery): Promise<Paginated<AdminTeamRow>>;
    /** GET /admin/teams/:id, with the members' names and emails (null = not found) */
    getTeam(id: string): Promise<AdminTeamDetail | null>;
    /** GET /admin/rounds (every round in order, with entries by status and the promotions; admin only) */
    listRounds(): Promise<AdminRound[]>;
    /** GET /admin/rounds/:id/jury (a video round's judges and the jury accounts to add; null = not found) */
    getRoundJury(id: string): Promise<AdminRoundJury | null>;
    /** GET /jury/rounds (role jury: the video rounds this judge scores in) */
    listJuryRounds(): Promise<JuryRound[]>;
    /** GET /jury/entries?round=&status=&page= (role jury: blind rows after the close) */
    listJuryEntries(query: JuryEntryQuery): Promise<Paginated<JuryEntryRow>>;
    /** GET /admin/certificates?q=&type=&round=&page= (admin only; with the student's contact) */
    listCertificates(query: AdminCertificateQuery): Promise<Paginated<AdminCertificateRow>>;
    /** GET /admin/announcements?page=&status= (every status, with audience and author) */
    listAnnouncements(query: AdminAnnouncementQuery): Promise<Paginated<AdminAnnouncement>>;
    /** GET /admin/payments?invoice=&trx=&phone=&email=&status=&review=1&page= (admin only) */
    listPayments(query: AdminPaymentQuery): Promise<Paginated<AdminPaymentRow>>;
    /** GET /admin/payments/:id, with its events (null = not found) */
    getPayment(id: string): Promise<AdminPaymentDetail | null>;
    /** GET /admin/settings (the keys an admin may change) */
    listSettings(): Promise<AdminSetting[]>;
    /** GET /admin/book (title, cover, upload limits) */
    getBook(): Promise<AdminBookInfo>;
    /** GET /admin/book-orders?page=&pageSize=&status=&district=&phone=&email= */
    listBookOrders(query: AdminBookOrderQuery): Promise<Paginated<AdminBookOrderRow>>;
    /** GET /admin/audit?action=&actor=&from=&to=&before=&limit= (keyset pages, newest first; admin only) */
    listAudit(query: AdminAuditQuery): Promise<AdminAuditPage>;
    /** GET /admin/audit/:id, with the IP, the actor's email and the meta (null = not found) */
    getAuditEntry(id: string): Promise<AdminAuditDetail | null>;
  };
}
