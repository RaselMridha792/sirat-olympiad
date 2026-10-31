/**
 * Where the result page sends a student whose payment completed: there is no session after paying (plan D2), so it is
 * the login page, which then opens the free book (plan §16.4). A2's safeNext accepts the path (links.test.ts).
 */
export const BOOK_LOGIN_HREF = '/login?next=%2Fdashboard%2Fbook';
