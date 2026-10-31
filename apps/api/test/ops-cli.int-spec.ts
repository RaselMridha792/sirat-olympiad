/**
 * The ops commands as processes (L10, L11): main() itself, with its settings, connections and exit codes, against
 * the test database and Redis. An earlier test called raiseOpsAlert directly and missed that main() could not run
 * outside the Nest app. CI's docker job also runs the compiled commands inside the built api image.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { testPrisma } from './helpers';

const API = path.resolve(__dirname, '..');
const prisma: PrismaClient = testPrisma();

afterAll(() => prisma.$disconnect());

function run(
  cli: 'ops-alert' | 'ops-check',
  args: string[],
  input = '',
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [require.resolve('tsx/cli'), path.join('src', 'cli', `${cli}.ts`), ...args],
      { cwd: API, env: { ...process.env, SECURITY_ALERT_EMAIL: '' } },
    );
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(input);
  });
}

const host = {
  diskUsedPercent: 40,
  cpuBusyPercent: 10,
  memoryUsedPercent: 40,
  swapUsedMb: 0,
  containersBad: 0,
  requests: 10,
  responses5xx: 0,
  apiP95Ms: 50,
  webRenderErrors: 0,
  api5xxLogged: 0,
  certificateDaysLeft: null,
  backupAgeHours: 2,
  timeSynced: true,
};

describe('the ops commands as processes', () => {
  it('ops-alert records an ops alert (exit 0) and refuses another category (exit 2)', async () => {
    const mark = Math.floor(Math.random() * 1e9);
    const ok = await run('ops-alert', ['--kind', 'ops.alert_test', '--meta', `cliTest=${mark}`]);
    expect(ok.out).toContain('ops-alert: ops.alert_test recorded');
    expect(ok.code).toBe(0);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'security.ops.alert_test', meta: { path: ['cliTest'], equals: mark } },
    });
    expect(rows).toHaveLength(1);
    const refused = await run('ops-alert', ['--kind', 'payments.needs_review']);
    expect(refused.code).toBe(2);
  }, 60_000);

  it('ops-check runs a dry run, a digest without a recipient, and refuses bad input', async () => {
    const dry = await run('ops-check', ['--dry-run'], JSON.stringify({ host, state: null }));
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/^OPS critical=[a-z_,]* warn=[a-z_,]* alerts=0$/m);
    const state = /^STATE (.+)$/m.exec(dry.out)?.[1];
    expect(JSON.parse(state ?? 'null')).toMatchObject({ streaks: {}, alerts: {} });
    const digest = await run('ops-check', ['--digest'], JSON.stringify({ host }));
    expect(digest.out).toContain('DIGEST no_recipient');
    expect(digest.code).toBe(0);
    const bad = await run('ops-check', ['--dry-run'], '{"host":{"diskUsedPercent":"full"}}');
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('host.diskUsedPercent must be a number or null');
  }, 90_000);
});
