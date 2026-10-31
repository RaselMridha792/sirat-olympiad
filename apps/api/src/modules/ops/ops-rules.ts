/**
 * Server checks (LAUNCH-PLAN §6, L11): pure thresholds and the alert transitions, so table tests cover every rule.
 * monitor.sh collects the host facts every 5 minutes, ops-check adds the app facts (queues, workers, failed jobs,
 * Redis memory) and the state of the last run, and these functions decide each check's level and which alerts to
 * raise. Thresholds are the launch defaults; L14 retunes them after the k6 run on the VPS.
 */

export type CheckLevel = 'ok' | 'warn' | 'critical';
export const LEVEL_CODE: Record<CheckLevel, number> = { ok: 0, warn: 1, critical: 2 };

/** The checks; each raises its own `ops.<check>` alert kind. */
export const OPS_CHECKS = [
  'disk',
  'swap',
  'cpu',
  'memory',
  'containers',
  'queue_redis_memory',
  'workers',
  'queue_backlog',
  'failed_jobs',
  'reconciliation',
  'http_5xx',
  'app_errors',
  'api_p95',
  'certificate',
  'backup_age',
  'time_sync',
] as const;
export type OpsCheck = (typeof OPS_CHECKS)[number];

export const THRESHOLDS = {
  diskWarnPercent: 80,
  diskCriticalPercent: 90,
  busyWarnPercent: 85, // CPU or memory, on two runs (RULEBOOK §12)
  memoryCriticalPercent: 95,
  queueRedisWarnMb: 300,
  queueRedisCriticalMb: 400, // of 512
  backlogWarnJobs: 500,
  backlogWarnAgeSeconds: 5 * 60,
  stuckCriticalAgeSeconds: 15 * 60, // a payments or email job waiting while workers are connected
  http5xxMinRequests: 50,
  http5xxWarnPercent: 2,
  http5xxCriticalPercent: 10,
  apiP95WarnMs: 1_000,
  certificateWarnDays: 14,
  backupCriticalHours: 26,
  reconcileMissedIntervals: 3,
  twoRuns: 2,
} as const;

/** What monitor.sh measures on the host (the last 5 minutes for the logs). Null: could not be measured. */
export interface HostFacts {
  diskUsedPercent: number | null;
  cpuBusyPercent: number | null;
  memoryUsedPercent: number | null;
  swapUsedMb: number | null;
  /** Services not running or unhealthy. */
  containersBad: number | null;
  requests: number | null;
  responses5xx: number | null;
  apiP95Ms: number | null;
  webRenderErrors: number | null;
  api5xxLogged: number | null;
  certificateDaysLeft: number | null;
  backupAgeHours: number | null;
  timeSynced: boolean | null;
}

export interface QueueFacts {
  name: 'email' | 'payments' | 'exam';
  workers: number;
  waiting: number;
  oldestWaitingSeconds: number | null;
  /** Jobs that failed for good since the last run (by finish time). */
  failedSinceLastRun: number;
  /** Of those, payment verify jobs (RULEBOOK §9: critical). */
  failedVerifySinceLastRun: number;
}

/** What ops-check measures inside the stack. */
export interface AppFacts {
  queueRedisMemoryMb: number;
  queues: QueueFacts[];
  /** Seconds since the payments reconciliation was due and did not run (0 = on time); null when it has no schedule. */
  reconcileOverdueSeconds: number | null;
  reconcileIntervalSeconds: number;
}

export interface CheckResult {
  check: OpsCheck;
  level: CheckLevel;
  /** The main number behind the level, for the alert (a percentage, a count, seconds, ...). */
  value: number | null;
}

/** Kept between runs by monitor.sh (a file on the host), so two-run rules and transitions need no database. */
export interface OpsState {
  /** Consecutive runs a two-run condition held. */
  streaks: Partial<Record<'cpu' | 'memory' | 'containers' | 'workers', number>>;
  /** The level each check last alerted with, and when (epoch ms). */
  alerts: Partial<Record<OpsCheck, { level: CheckLevel; at: number }>>;
}

export const EMPTY_STATE: OpsState = { streaks: {}, alerts: {} };

const worst = (...levels: CheckLevel[]): CheckLevel =>
  levels.includes('critical') ? 'critical' : levels.includes('warn') ? 'warn' : 'ok';

/** Every check's level for this run, and the streaks for the next one. */
export function evaluate(
  host: HostFacts,
  app: AppFacts,
  previous: OpsState,
): { results: CheckResult[]; streaks: OpsState['streaks'] } {
  const t = THRESHOLDS;
  const streaks: OpsState['streaks'] = {};
  const streak = (key: keyof OpsState['streaks'], holds: boolean): number => {
    const n = holds ? (previous.streaks[key] ?? 0) + 1 : 0;
    streaks[key] = n;
    return n;
  };
  const results: CheckResult[] = [];
  const add = (check: OpsCheck, level: CheckLevel, value: number | null) =>
    results.push({ check, level, value });

  const disk = host.diskUsedPercent;
  add(
    'disk',
    disk === null
      ? 'ok'
      : disk >= t.diskCriticalPercent
        ? 'critical'
        : disk >= t.diskWarnPercent
          ? 'warn'
          : 'ok',
    disk,
  );
  add('swap', host.swapUsedMb !== null && host.swapUsedMb > 0 ? 'warn' : 'ok', host.swapUsedMb);

  const cpuRuns = streak(
    'cpu',
    host.cpuBusyPercent !== null && host.cpuBusyPercent > t.busyWarnPercent,
  );
  add('cpu', cpuRuns >= t.twoRuns ? 'warn' : 'ok', host.cpuBusyPercent);

  const memory = host.memoryUsedPercent;
  const memoryRuns = streak('memory', memory !== null && memory > t.busyWarnPercent);
  add(
    'memory',
    memory !== null && memory > t.memoryCriticalPercent
      ? 'critical'
      : memoryRuns >= t.twoRuns
        ? 'warn'
        : 'ok',
    memory,
  );

  const containerRuns = streak('containers', (host.containersBad ?? 0) > 0);
  add('containers', containerRuns >= t.twoRuns ? 'critical' : 'ok', host.containersBad);

  const redisMb = app.queueRedisMemoryMb;
  add(
    'queue_redis_memory',
    redisMb >= t.queueRedisCriticalMb ? 'critical' : redisMb >= t.queueRedisWarnMb ? 'warn' : 'ok',
    redisMb,
  );

  const idleQueues = app.queues.filter((q) => q.workers === 0).length;
  const workerRuns = streak('workers', idleQueues > 0);
  add('workers', workerRuns >= t.twoRuns ? 'critical' : 'ok', idleQueues);

  const backlog = app.queues.map((q): CheckLevel => {
    const oldest = q.oldestWaitingSeconds ?? 0;
    if (
      (q.name === 'payments' || q.name === 'email') &&
      q.workers > 0 &&
      oldest > t.stuckCriticalAgeSeconds
    )
      return 'critical'; // workers connected, but a job waits: a stuck worker
    return q.waiting > t.backlogWarnJobs || oldest > t.backlogWarnAgeSeconds ? 'warn' : 'ok';
  });
  add(
    'queue_backlog',
    worst(...backlog),
    Math.max(0, ...app.queues.map((q) => q.oldestWaitingSeconds ?? 0)),
  );

  const failed = app.queues.reduce((n, q) => n + q.failedSinceLastRun, 0);
  const failedVerify = app.queues.reduce((n, q) => n + q.failedVerifySinceLastRun, 0);
  add('failed_jobs', failedVerify > 0 ? 'critical' : failed > 0 ? 'warn' : 'ok', failed);

  const overdue = app.reconcileOverdueSeconds;
  add(
    'reconciliation',
    overdue === null || overdue > t.reconcileMissedIntervals * app.reconcileIntervalSeconds
      ? 'critical'
      : 'ok',
    overdue,
  );

  const requests = host.requests ?? 0;
  const percent5xx = requests > 0 ? ((host.responses5xx ?? 0) * 100) / requests : 0;
  add(
    'http_5xx',
    requests < t.http5xxMinRequests
      ? 'ok'
      : percent5xx > t.http5xxCriticalPercent
        ? 'critical'
        : percent5xx > t.http5xxWarnPercent
          ? 'warn'
          : 'ok',
    Math.round(percent5xx * 10) / 10,
  );

  const appErrors = (host.webRenderErrors ?? 0) + (host.api5xxLogged ?? 0);
  add('app_errors', appErrors > 0 ? 'warn' : 'ok', appErrors);
  add(
    'api_p95',
    host.apiP95Ms !== null && host.apiP95Ms > t.apiP95WarnMs ? 'warn' : 'ok',
    host.apiP95Ms,
  );
  add(
    'certificate',
    host.certificateDaysLeft !== null && host.certificateDaysLeft < t.certificateWarnDays
      ? 'warn'
      : 'ok',
    host.certificateDaysLeft,
  );
  add(
    'backup_age',
    host.backupAgeHours === null || host.backupAgeHours > t.backupCriticalHours ? 'critical' : 'ok',
    host.backupAgeHours,
  );
  add('time_sync', host.timeSynced === false ? 'warn' : 'ok', host.timeSynced === false ? 0 : 1);
  return { results, streaks };
}

export const REMINDER_MS = 60 * 60_000;

export interface OpsAlert {
  check: OpsCheck;
  level: CheckLevel;
  value: number | null;
  /** 'change' (including a resolved one) or 'reminder'. */
  reason: 'change' | 'reminder';
}

/**
 * An alert only when a check changes level (back to ok is the one "resolved" alert), then an hourly reminder while it
 * stays warn or critical. Returns the alerts to raise and the memory for the next run.
 */
export function decideAlerts(
  results: CheckResult[],
  previous: OpsState['alerts'],
  now: number,
): { alerts: OpsAlert[]; memory: OpsState['alerts'] } {
  const alerts: OpsAlert[] = [];
  const memory: OpsState['alerts'] = {};
  for (const r of results) {
    const last = previous[r.check];
    const lastLevel = last?.level ?? 'ok';
    if (r.level !== lastLevel) {
      alerts.push({ check: r.check, level: r.level, value: r.value, reason: 'change' });
      if (r.level !== 'ok') memory[r.check] = { level: r.level, at: now };
    } else if (r.level !== 'ok' && last) {
      if (now - last.at >= REMINDER_MS) {
        alerts.push({ check: r.check, level: r.level, value: r.value, reason: 'reminder' });
        memory[r.check] = { level: r.level, at: now };
      } else {
        memory[r.check] = last;
      }
    }
  }
  return { alerts, memory };
}

/** monitor.sh's summary: critical states fail the heartbeat (with kind names only), warnings do not. */
export function summarize(results: CheckResult[]): { critical: OpsCheck[]; warn: OpsCheck[] } {
  return {
    critical: results.filter((r) => r.level === 'critical').map((r) => r.check),
    warn: results.filter((r) => r.level === 'warn').map((r) => r.check),
  };
}
