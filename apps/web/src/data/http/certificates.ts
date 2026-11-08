import {
  CERTIFICATE_TYPES,
  type AdminCertificateRow,
  type MyCertificate,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Certificates (core C6c-1; 06-API "Certificates"). Reads only: issuing and revoking are browser writes through
 * lib/api.ts, and the public check is called from the browser (so its limit counts the visitor's IP). Every field
 * is checked and picked by name.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const isType = (v: unknown) =>
  typeof v === 'string' && (CERTIFICATE_TYPES as readonly string[]).includes(v);
const isRound = (v: unknown) => isRecord(v) && text(v.id) && text(v.name);

const isMine = (v: unknown): v is MyCertificate =>
  isRecord(v) &&
  text(v.id) &&
  isType(v.type) &&
  isRound(v.round) &&
  text(v.serial) &&
  text(v.verificationCode) &&
  text(v.nameOnCertificate) &&
  text(v.issuedAt) &&
  typeof v.revoked === 'boolean';

const isRow = (v: unknown): v is AdminCertificateRow =>
  isRecord(v) &&
  text(v.id) &&
  isRecord(v.user) &&
  text(v.user.userId) &&
  text(v.user.name) &&
  text(v.user.email) &&
  isType(v.type) &&
  isRound(v.round) &&
  text(v.serial) &&
  text(v.nameOnCertificate) &&
  text(v.issuedAt) &&
  textOrNull(v.revokedAt) &&
  textOrNull(v.revokeReason) &&
  text(v.updatedAt) &&
  typeof v.demo === 'boolean';

const isRowPage = (v: unknown): v is Paginated<AdminCertificateRow> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

export function studentCertificates(
  get: ApiGet,
): Pick<DataSource['student'], 'listMyCertificates'> {
  return {
    /** GET /certificates/mine: the student's own certificates (a few at most). */
    async listMyCertificates() {
      const list = await getJson(
        get,
        '/certificates/mine',
        (v): v is MyCertificate[] => Array.isArray(v) && v.every(isMine),
      );
      return list.map((c) => ({
        id: c.id,
        type: c.type,
        round: { id: c.round.id, name: c.round.name },
        serial: c.serial,
        verificationCode: c.verificationCode,
        nameOnCertificate: c.nameOnCertificate,
        issuedAt: c.issuedAt,
        revoked: c.revoked,
      }));
    },
  };
}

export function adminCertificates(get: ApiGet): Pick<DataSource['admin'], 'listCertificates'> {
  return {
    /** GET /admin/certificates?q=&type=&round=&page=&pageSize= (admin). */
    async listCertificates(query) {
      const page = await getJson(
        get,
        withQuery('/admin/certificates', {
          q: query.q,
          type: query.type,
          round: query.round,
          page: query.page,
          pageSize: query.pageSize,
        }),
        isRowPage,
      );
      return {
        items: page.items.map((r) => ({
          id: r.id,
          user: { userId: r.user.userId, name: r.user.name, email: r.user.email },
          type: r.type,
          round: { id: r.round.id, name: r.round.name },
          serial: r.serial,
          nameOnCertificate: r.nameOnCertificate,
          issuedAt: r.issuedAt,
          revokedAt: r.revokedAt,
          revokeReason: r.revokeReason,
          updatedAt: r.updatedAt,
          demo: r.demo,
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
