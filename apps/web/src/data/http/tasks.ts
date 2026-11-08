import type { AdminTaskReviewRow, AdminTaskRow, Paginated } from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Ambassador tasks for admins (core C5b-2; 06-API "Ambassadors"). Reads only: create, edit, archive, assign and review
 * are browser writes through lib/api.ts. Every row is checked and picked by name.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

const isTask = (v: unknown): v is AdminTaskRow =>
  isRecord(v) &&
  text(v.id) &&
  text(v.title) &&
  text(v.description) &&
  count(v.points) &&
  textOrNull(v.archivedAt) &&
  text(v.createdAt) &&
  text(v.updatedAt) &&
  isRecord(v.counts) &&
  ['assigned', 'submitted', 'approved', 'rejected'].every((k) =>
    count((v.counts as Record<string, unknown>)[k]),
  ) &&
  typeof v.demo === 'boolean';

const isReview = (v: unknown): v is AdminTaskReviewRow =>
  isRecord(v) &&
  text(v.assignmentId) &&
  text(v.taskId) &&
  text(v.taskTitle) &&
  count(v.points) &&
  isRecord(v.ambassador) &&
  text(v.ambassador.userId) &&
  text(v.ambassador.name) &&
  text(v.proof) &&
  text(v.submittedAt) &&
  typeof v.demo === 'boolean';

const pageOf =
  <T>(isRow: (v: unknown) => v is T) =>
  (v: unknown): v is Paginated<T> =>
    isRecord(v) &&
    Array.isArray(v.items) &&
    v.items.every(isRow) &&
    count(v.page) &&
    count(v.pageSize) &&
    count(v.total);

export function adminTasks(
  get: ApiGet,
): Pick<DataSource['admin'], 'listTasks' | 'listTaskReviews'> {
  return {
    /** GET /admin/tasks?status=&page=&pageSize= (admin). */
    async listTasks(query) {
      const page = await getJson(
        get,
        withQuery('/admin/tasks', {
          status: query.status,
          page: query.page,
          pageSize: query.pageSize,
        }),
        pageOf(isTask),
      );
      return {
        items: page.items.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          points: t.points,
          archivedAt: t.archivedAt,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          counts: {
            assigned: t.counts.assigned,
            submitted: t.counts.submitted,
            approved: t.counts.approved,
            rejected: t.counts.rejected,
          },
          demo: t.demo,
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
    /** GET /admin/task-assignments?page=&pageSize= (admin): submitted proofs, oldest first. */
    async listTaskReviews(query) {
      const page = await getJson(
        get,
        withQuery('/admin/task-assignments', { page: query.page, pageSize: query.pageSize }),
        pageOf(isReview),
      );
      return {
        items: page.items.map((r) => ({
          assignmentId: r.assignmentId,
          taskId: r.taskId,
          taskTitle: r.taskTitle,
          points: r.points,
          ambassador: { userId: r.ambassador.userId, name: r.ambassador.name },
          proof: r.proof,
          submittedAt: r.submittedAt,
          demo: r.demo,
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
