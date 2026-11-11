import {
  DEMO_BATCH_STATUSES,
  isParticipantId,
  type AdminDemoStatus,
  type DemoLogin,
  type DemoOutcome,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, type ApiGet } from './request.ts';

/*
 * The demo data card's status (exam; 06-API "Demo data"). The shape is checked and every field is picked by name, so
 * nothing the API adds later reaches the page.
 */

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const counts = (v: unknown): v is Record<string, number> =>
  isRecord(v) && Object.values(v).every(count);
const action = (v: unknown) => v === 'load' || v === 'clear';
const RESULTS: readonly unknown[] = ['done', 'failed', 'blocked'];

function isOutcome(v: unknown): v is DemoOutcome {
  return (
    isRecord(v) &&
    action(v.action) &&
    RESULTS.includes(v.result) &&
    typeof v.at === 'string' &&
    (v.blockers === undefined || counts(v.blockers))
  );
}

/** A demo login: a student or an ambassador with a valid participant ID, or the jury without one. */
function isLogin(v: unknown): v is DemoLogin {
  if (!isRecord(v) || typeof v.email !== 'string' || typeof v.name !== 'string') return false;
  if (v.role === 'jury') return v.participantId === null;
  return (
    (v.role === 'student' || v.role === 'ambassador') &&
    typeof v.participantId === 'string' &&
    isParticipantId(v.participantId)
  );
}

function isDemoStatus(v: unknown): v is AdminDemoStatus {
  if (!isRecord(v) || typeof v.allowed !== 'boolean') return false;
  const b = v.batch;
  const batchOk =
    b === null ||
    (isRecord(b) &&
      typeof b.id === 'string' &&
      (DEMO_BATCH_STATUSES as readonly unknown[]).includes(b.status) &&
      typeof b.createdAt === 'string' &&
      typeof b.createdByName === 'string' &&
      counts(b.counts) &&
      typeof b.stale === 'boolean' &&
      Array.isArray(b.logins) &&
      b.logins.every(isLogin) &&
      count(b.unregisteredStudents));
  const p = v.progress;
  const progressOk = p === null || (isRecord(p) && action(p.action) && typeof p.step === 'string');
  return batchOk && progressOk && (v.lastOutcome === null || isOutcome(v.lastOutcome));
}

/** Field by field: only what the card shows. */
export function pickDemoStatus(s: AdminDemoStatus): AdminDemoStatus {
  const o = s.lastOutcome;
  return {
    allowed: s.allowed,
    batch: s.batch && {
      id: s.batch.id,
      status: s.batch.status,
      createdAt: s.batch.createdAt,
      createdByName: s.batch.createdByName,
      counts: { ...s.batch.counts },
      stale: s.batch.stale,
      logins: s.batch.logins.map((l) => ({
        role: l.role,
        email: l.email,
        name: l.name,
        participantId: l.participantId,
      })),
      unregisteredStudents: s.batch.unregisteredStudents,
    },
    progress: s.progress && { action: s.progress.action, step: s.progress.step },
    lastOutcome: o && {
      action: o.action,
      result: o.result,
      at: o.at,
      ...(o.blockers ? { blockers: { ...o.blockers } } : {}),
    },
  };
}

export function adminDemo(get: ApiGet): Pick<DataSource['admin'], 'getDemoStatus'> {
  return {
    /** GET /admin/demo (admin only). */
    async getDemoStatus() {
      return pickDemoStatus(await getJson(get, '/admin/demo', isDemoStatus));
    },
  };
}
