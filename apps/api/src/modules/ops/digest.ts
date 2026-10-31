import type { PrismaClient } from '@prisma/client';
import { escapeHtml } from '../../common/html';
import type { EmailMessage } from '../notifications/email.types';

/*
 * The daily digest (LAUNCH-PLAN §6, L11), sent at 08:00 Asia/Dhaka by `ops-check --digest`: the last 24 h of alerts
 * by kind (from the audit log, so the ones the caps held back count too), the backup age, the disk, and the payments
 * by status. One a day: an `ops.digest` audit row for the Dhaka date is the record that it went out. It also proves
 * every morning that the alert email path works. Counts and kinds only, never an address or a name.
 */

const DHAKA_OFFSET_MS = 6 * 60 * 60_000; // UTC+6 all year (no daylight saving since 2009)

/** The Asia/Dhaka date of `at`, as YYYY-MM-DD, and when that day started (UTC). */
export function dhakaDay(at: Date): { date: string; startsAt: Date } {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  const date = local.toISOString().slice(0, 10);
  return { date, startsAt: new Date(Date.parse(`${date}T00:00:00Z`) - DHAKA_OFFSET_MS) };
}

export interface DigestFacts {
  date: string;
  alerts: Array<{ action: string; count: number }>;
  payments: Array<{ status: string; count: number }>;
  diskUsedPercent: number | null;
  backupAgeHours: number | null;
}

export function digestMessage(to: string, facts: DigestFacts): EmailMessage {
  const alerts = facts.alerts.length
    ? facts.alerts.map((a) => `  ${a.action.replace(/^security\./, '')}: ${a.count}`)
    : ['  none'];
  const payments = facts.payments.length
    ? facts.payments.map((p) => `  ${p.status}: ${p.count}`)
    : ['  none'];
  const lines = [
    `Sirat daily digest for ${facts.date} (Asia/Dhaka)`,
    '',
    'Alerts in the last 24 hours, by kind (including those held back by the email caps):',
    ...alerts,
    '',
    `Newest backup: ${facts.backupAgeHours === null ? 'none found' : `${facts.backupAgeHours} h old`}`,
    `Disk used: ${facts.diskUsedPercent === null ? 'unknown' : `${facts.diskUsedPercent}%`}`,
    '',
    'Payments by status (all time):',
    ...payments,
    '',
    'This email arrives every morning; when it does not, the alert email path is broken (RUNBOOK §7).',
  ];
  const text = lines.join('\n');
  return {
    to,
    subject: `[Sirat] Daily digest ${facts.date}`,
    text,
    html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`,
  };
}

/** Alerts of the last 24 h by audit action, and payments by status. */
export async function collectDigestCounts(
  prisma: PrismaClient,
  now: Date,
): Promise<Pick<DigestFacts, 'alerts' | 'payments'>> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [alerts, payments] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { action: { startsWith: 'security.' }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { action: 'asc' },
    }),
    prisma.payment.groupBy({
      by: ['status'],
      _count: { _all: true },
      orderBy: { status: 'asc' },
    }),
  ]);
  return {
    alerts: alerts.map((a) => ({ action: a.action, count: a._count._all })),
    payments: payments.map((p) => ({ status: p.status, count: p._count._all })),
  };
}

export type DigestOutcome = 'sent' | 'already_sent' | 'no_recipient' | 'not_queued';

/** Sends today's digest once: the `ops.digest` audit row for today's Dhaka date says it went out. */
export async function sendDailyDigest(deps: {
  prisma: PrismaClient;
  enqueue: (kind: string, key: string, message: EmailMessage) => Promise<boolean>;
  to: string | undefined;
  host: Pick<DigestFacts, 'diskUsedPercent' | 'backupAgeHours'>;
  now: Date;
}): Promise<DigestOutcome> {
  if (!deps.to) return 'no_recipient';
  const { date, startsAt } = dhakaDay(deps.now);
  const sent = await deps.prisma.auditLog.findFirst({
    where: { action: 'ops.digest', createdAt: { gte: startsAt } },
    select: { id: true },
  });
  if (sent) return 'already_sent';
  const counts = await collectDigestCounts(deps.prisma, deps.now);
  const queued = await deps.enqueue(
    'ops-digest',
    `ops-digest.${date}`,
    digestMessage(deps.to, { date, ...counts, ...deps.host }),
  );
  if (!queued) return 'not_queued';
  await deps.prisma.auditLog.create({
    data: { action: 'ops.digest', meta: { date: Number(date.replace(/-/g, '')) } },
  });
  return 'sent';
}
