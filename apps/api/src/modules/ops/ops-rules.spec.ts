import {
  EMPTY_STATE,
  REMINDER_MS,
  decideAlerts,
  evaluate,
  summarize,
  type AppFacts,
  type CheckLevel,
  type CheckResult,
  type HostFacts,
  type OpsCheck,
  type OpsState,
  type QueueFacts,
} from './ops-rules';

/* Every threshold of LAUNCH-PLAN §6 as a table, the two-run rules, and the alert transitions (L11). */

const host = (over: Partial<HostFacts> = {}): HostFacts => ({
  diskUsedPercent: 40,
  cpuBusyPercent: 20,
  memoryUsedPercent: 50,
  swapUsedMb: 0,
  containersBad: 0,
  requests: 1_000,
  responses5xx: 0,
  apiP95Ms: 120,
  webRenderErrors: 0,
  api5xxLogged: 0,
  certificateDaysLeft: 60,
  backupAgeHours: 1,
  timeSynced: true,
  trustedGeneratorsMinutesLeft: null,
  ...over,
});
const queue = (name: QueueFacts['name'], over: Partial<QueueFacts> = {}): QueueFacts => ({
  name,
  workers: 1,
  waiting: 0,
  oldestWaitingSeconds: null,
  failedSinceLastRun: 0,
  failedVerifySinceLastRun: 0,
  ...over,
});
const app = (over: Partial<AppFacts> = {}): AppFacts => ({
  queueRedisMemoryMb: 20,
  queues: [queue('email'), queue('payments'), queue('exam')],
  reconcileOverdueSeconds: 0,
  reconcileIntervalSeconds: 600,
  ...over,
});
const levelOf = (results: CheckResult[], check: OpsCheck) =>
  results.find((r) => r.check === check)?.level;
const once = (h: HostFacts, a: AppFacts = app(), state: OpsState = EMPTY_STATE) =>
  evaluate(h, a, state);

describe('ops thresholds (one run)', () => {
  it('a healthy server is ok on every check', () => {
    const { results } = once(host());
    expect(summarize(results)).toEqual({ critical: [], warn: [] });
    expect(results).toHaveLength(17);
  });

  it.each<[string, Partial<HostFacts>, OpsCheck, CheckLevel]>([
    ['disk 79%', { diskUsedPercent: 79 }, 'disk', 'ok'],
    ['disk 80%', { diskUsedPercent: 80 }, 'disk', 'warn'],
    ['disk 90%', { diskUsedPercent: 90 }, 'disk', 'critical'],
    ['any swap', { swapUsedMb: 1 }, 'swap', 'warn'],
    ['memory 96%', { memoryUsedPercent: 96 }, 'memory', 'critical'],
    ['memory 90% once', { memoryUsedPercent: 90 }, 'memory', 'ok'],
    ['CPU 99% once', { cpuBusyPercent: 99 }, 'cpu', 'ok'],
    ['a bad container once', { containersBad: 1 }, 'containers', 'ok'],
    ['3% 5xx of 100', { requests: 100, responses5xx: 3 }, 'http_5xx', 'warn'],
    ['11% 5xx of 100', { requests: 100, responses5xx: 11 }, 'http_5xx', 'critical'],
    ['2% 5xx of 100', { requests: 100, responses5xx: 2 }, 'http_5xx', 'ok'],
    ['all 5xx but only 49 requests', { requests: 49, responses5xx: 49 }, 'http_5xx', 'ok'],
    ['a web render error', { webRenderErrors: 1 }, 'app_errors', 'warn'],
    ['an API 5xx in its log', { api5xxLogged: 2 }, 'app_errors', 'warn'],
    ['p95 1001 ms', { apiP95Ms: 1_001 }, 'api_p95', 'warn'],
    ['p95 1000 ms', { apiP95Ms: 1_000 }, 'api_p95', 'ok'],
    ['certificate 13 days', { certificateDaysLeft: 13 }, 'certificate', 'warn'],
    ['certificate unknown', { certificateDaysLeft: null }, 'certificate', 'ok'],
    ['backup 27 h old', { backupAgeHours: 27 }, 'backup_age', 'critical'],
    ['no backup found', { backupAgeHours: null }, 'backup_age', 'critical'],
    ['clock not synced', { timeSynced: false }, 'time_sync', 'warn'],
    ['trusted generators off', { trustedGeneratorsMinutesLeft: null }, 'trusted_generators', 'ok'],
    [
      'trusted generators on, 90 min left',
      { trustedGeneratorsMinutesLeft: 90 },
      'trusted_generators',
      'warn',
    ],
    [
      'trusted generators on, expiring now',
      { trustedGeneratorsMinutesLeft: 0 },
      'trusted_generators',
      'warn',
    ],
    [
      'trusted generators past their expiry',
      { trustedGeneratorsMinutesLeft: -1 },
      'trusted_generators',
      'critical',
    ],
  ])('%s', (_label, over, check, level) => {
    expect(levelOf(once(host(over)).results, check)).toBe(level);
  });

  it.each<[string, Partial<AppFacts>, OpsCheck, CheckLevel]>([
    ['queue Redis 300 MB', { queueRedisMemoryMb: 300 }, 'queue_redis_memory', 'warn'],
    ['queue Redis 400 MB', { queueRedisMemoryMb: 400 }, 'queue_redis_memory', 'critical'],
    ['501 waiting jobs', { queues: [queue('exam', { waiting: 501 })] }, 'queue_backlog', 'warn'],
    [
      'oldest job 6 min',
      { queues: [queue('exam', { waiting: 1, oldestWaitingSeconds: 360 })] },
      'queue_backlog',
      'warn',
    ],
    [
      'a payments job waiting 16 min with a worker: stuck',
      { queues: [queue('payments', { waiting: 1, oldestWaitingSeconds: 960 })] },
      'queue_backlog',
      'critical',
    ],
    [
      'an email job waiting 16 min with no worker: the workers check says so, not stuck',
      { queues: [queue('email', { workers: 0, waiting: 1, oldestWaitingSeconds: 960 })] },
      'queue_backlog',
      'warn',
    ],
    ['a failed job', { queues: [queue('exam', { failedSinceLastRun: 1 })] }, 'failed_jobs', 'warn'],
    [
      'a nightly cleanup that failed for good',
      { queues: [queue('housekeeping', { failedSinceLastRun: 1 })] },
      'failed_jobs',
      'warn',
    ],
    [
      'a referral points sweep that failed for good',
      { queues: [queue('ambassador', { failedSinceLastRun: 1 })] },
      'failed_jobs',
      'warn',
    ],
    [
      'a failed payment verify job',
      { queues: [queue('payments', { failedSinceLastRun: 1, failedVerifySinceLastRun: 1 })] },
      'failed_jobs',
      'critical',
    ],
    ['reconciliation 3 intervals late', { reconcileOverdueSeconds: 1_800 }, 'reconciliation', 'ok'],
    [
      'reconciliation over 3 intervals late',
      { reconcileOverdueSeconds: 1_801 },
      'reconciliation',
      'critical',
    ],
    ['no reconciliation schedule', { reconcileOverdueSeconds: null }, 'reconciliation', 'critical'],
  ])('%s', (_label, over, check, level) => {
    expect(levelOf(once(host(), app(over)).results, check)).toBe(level);
  });
});

describe('two-run rules', () => {
  it.each<[string, Partial<HostFacts>, Partial<AppFacts>, OpsCheck, CheckLevel]>([
    ['CPU over 85%', { cpuBusyPercent: 90 }, {}, 'cpu', 'warn'],
    ['memory over 85%', { memoryUsedPercent: 90 }, {}, 'memory', 'warn'],
    ['a container not running or unhealthy', { containersBad: 1 }, {}, 'containers', 'critical'],
    [
      'a queue with no worker',
      {},
      { queues: [queue('payments', { workers: 0 })] },
      'workers',
      'critical',
    ],
  ])('%s: only on the second run in a row', (_label, h, a, check, level) => {
    const first = evaluate(host(h), app(a), EMPTY_STATE);
    expect(levelOf(first.results, check)).toBe('ok');
    const second = evaluate(host(h), app(a), { ...EMPTY_STATE, streaks: first.streaks });
    expect(levelOf(second.results, check)).toBe(level);
    const recovered = evaluate(host(), app(), { ...EMPTY_STATE, streaks: second.streaks });
    expect(levelOf(recovered.results, check)).toBe('ok');
    const again = evaluate(host(h), app(a), { ...EMPTY_STATE, streaks: recovered.streaks });
    expect(levelOf(again.results, check)).toBe('ok'); // the streak starts over
  });
});

describe('alert transitions', () => {
  const disk = (level: CheckLevel): CheckResult[] => [{ check: 'disk', level, value: 85 }];
  const t0 = Date.UTC(2026, 10, 10, 4, 0);

  it('alert once on a change, stay quiet while it holds, remind hourly, and say resolved once', () => {
    const first = decideAlerts(disk('warn'), {}, t0);
    expect(first.alerts).toEqual([{ check: 'disk', level: 'warn', value: 85, reason: 'change' }]);
    const quiet = decideAlerts(disk('warn'), first.memory, t0 + 5 * 60_000);
    expect(quiet.alerts).toEqual([]);
    const reminder = decideAlerts(disk('warn'), quiet.memory, t0 + REMINDER_MS);
    expect(reminder.alerts).toEqual([
      { check: 'disk', level: 'warn', value: 85, reason: 'reminder' },
    ]);
    const worse = decideAlerts(disk('critical'), reminder.memory, t0 + REMINDER_MS + 300_000);
    expect(worse.alerts[0]).toMatchObject({ level: 'critical', reason: 'change' });
    const resolved = decideAlerts(disk('ok'), worse.memory, t0 + REMINDER_MS + 600_000);
    expect(resolved.alerts).toEqual([{ check: 'disk', level: 'ok', value: 85, reason: 'change' }]);
    expect(resolved.memory).toEqual({});
    expect(decideAlerts(disk('ok'), resolved.memory, t0 + 2 * REMINDER_MS).alerts).toEqual([]);
  });

  it('a check that has always been ok never alerts', () => {
    expect(decideAlerts(disk('ok'), {}, t0).alerts).toEqual([]);
  });
});
