import type { AdminTeamDetail, AdminTeamRow, MyTeam, Paginated } from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Ambassador teams (core C5b-3; 06-API "Ambassadors"). Reads only: create, join, leave and rename are browser writes
 * through lib/api.ts. Every field is checked and picked by name; a student's view carries first names only.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isMyTeam = (v: unknown): v is MyTeam =>
  isRecord(v) &&
  text(v.id) &&
  text(v.name) &&
  count(v.memberCount) &&
  typeof v.isOwner === 'boolean' &&
  textOrNull(v.joinCode) &&
  Array.isArray(v.members) &&
  v.members.every((m) => isRecord(m) && text(m.firstName) && typeof m.isOwner === 'boolean');

const isRow = (v: unknown): v is AdminTeamRow =>
  isRecord(v) &&
  text(v.id) &&
  text(v.name) &&
  isRecord(v.owner) &&
  text(v.owner.userId) &&
  text(v.owner.name) &&
  typeof v.open === 'boolean' &&
  count(v.memberCount) &&
  text(v.createdAt) &&
  text(v.updatedAt);

const isDetail = (v: unknown): v is AdminTeamDetail =>
  isRow(v) &&
  isRecord(v) &&
  Array.isArray(v.members) &&
  v.members.every(
    (m) => isRecord(m) && text(m.userId) && text(m.name) && text(m.email) && text(m.joinedAt),
  );

const isRowPage = (v: unknown): v is Paginated<AdminTeamRow> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

const pickRow = (r: AdminTeamRow): AdminTeamRow => ({
  id: r.id,
  name: r.name,
  owner: { userId: r.owner.userId, name: r.owner.name },
  open: r.open,
  memberCount: r.memberCount,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function pickMyTeam(t: MyTeam): MyTeam {
  return {
    id: t.id,
    name: t.name,
    memberCount: t.memberCount,
    isOwner: t.isOwner,
    joinCode: t.isOwner ? t.joinCode : null,
    members: t.members.map((m) => ({ firstName: m.firstName, isOwner: m.isOwner })),
  };
}

export function studentTeam(get: ApiGet): Pick<DataSource['student'], 'getMyTeam'> {
  return {
    /** GET /teams/mine; not in a team is null (the API answers 404). */
    async getMyTeam() {
      const team = await getJsonOrNull(get, '/teams/mine', isMyTeam);
      return team && pickMyTeam(team);
    },
  };
}

export function adminTeams(get: ApiGet): Pick<DataSource['admin'], 'listTeams' | 'getTeam'> {
  return {
    /** GET /admin/teams?q=&page=&pageSize= (admin). */
    async listTeams(query) {
      const page = await getJson(
        get,
        withQuery('/admin/teams', { q: query.q, page: query.page, pageSize: query.pageSize }),
        isRowPage,
      );
      return {
        items: page.items.map(pickRow),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
    /** GET /admin/teams/:id with the members' contact (admins only); a malformed id is simply not found. */
    async getTeam(id) {
      if (!UUID.test(id)) return null;
      const team = await getJsonOrNull(get, `/admin/teams/${id}`, isDetail);
      return (
        team && {
          ...pickRow(team),
          members: team.members.map((m) => ({
            userId: m.userId,
            name: m.name,
            email: m.email,
            joinedAt: m.joinedAt,
          })),
        }
      );
    },
  };
}
