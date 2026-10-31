import {
  ANNOUNCEMENT_STATUSES,
  CATEGORIES,
  type AdminAnnouncement,
  type AnnouncementItem,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Announcements (core session; 06-API "Announcements"). Reads only: admins write from the browser through lib/api.ts.
 * Shapes are checked and picked field by field.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v);

const isItem = (v: unknown): v is AnnouncementItem =>
  isRecord(v) && text(v.id) && text(v.title) && text(v.body) && text(v.publishedAt);

const isAdminItem = (v: unknown): v is AdminAnnouncement =>
  isRecord(v) &&
  isItem(v as unknown) &&
  (v.category === null || (CATEGORIES as readonly unknown[]).includes(v.category)) &&
  textOrNull(v.archivedAt) &&
  text(v.createdAt) &&
  text(v.updatedAt) &&
  (ANNOUNCEMENT_STATUSES as readonly unknown[]).includes(v.status) &&
  textOrNull(v.authorName);

const pageOf =
  <T>(isRow: (v: unknown) => v is T) =>
  (v: unknown): v is Paginated<T> =>
    isRecord(v) &&
    Array.isArray(v.items) &&
    v.items.every(isRow) &&
    count(v.page) &&
    count(v.pageSize) &&
    count(v.total);

export const pickItem = (a: AnnouncementItem): AnnouncementItem => ({
  id: a.id,
  title: a.title,
  body: a.body,
  publishedAt: a.publishedAt,
});

const pickAdminItem = (a: AdminAnnouncement): AdminAnnouncement => ({
  ...pickItem(a),
  category: a.category,
  archivedAt: a.archivedAt,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  status: a.status,
  authorName: a.authorName,
});

export function studentAnnouncements(
  get: ApiGet,
): Pick<DataSource['student'], 'listAnnouncements'> {
  return {
    /** GET /announcements: live ones for everyone or the student's category. */
    async listAnnouncements(query) {
      const page = await getJson(
        get,
        withQuery('/announcements', { page: query.page, pageSize: query.pageSize }),
        pageOf(isItem),
      );
      return { ...page, items: page.items.map(pickItem) };
    },
  };
}

export function adminAnnouncements(get: ApiGet): Pick<DataSource['admin'], 'listAnnouncements'> {
  return {
    /** GET /admin/announcements: every status. */
    async listAnnouncements(query) {
      const page = await getJson(
        get,
        withQuery('/admin/announcements', {
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
        }),
        pageOf(isAdminItem),
      );
      return {
        items: page.items.map(pickAdminItem),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
