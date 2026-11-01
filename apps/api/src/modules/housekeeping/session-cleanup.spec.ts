import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { type CleanupLimits, SessionCleanup, cleanupCutoffs } from './session-cleanup';

/* The batch loop and the cutoffs, with a fake database (the real SQL runs in test/session-cleanup.int-spec.ts). */

function harness(counts: number[], limits: Partial<CleanupLimits> = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?'));
      params.push(values);
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?'));
      params.push(values);
      return Promise.resolve(counts.shift() ?? 0);
    }),
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => Promise<number>) => fn(tx) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const cleanup = new SessionCleanup(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { batchSize: 3, maxBatches: 3, statementTimeoutMs: 4_000, ...limits },
  );
  return { cleanup, sql, params, audit };
}

const NOW = new Date('2026-12-20T03:30:00.000Z');

describe('cleanupCutoffs', () => {
  it('is 30 days back for sessions and 7 days back for tokens', () => {
    expect(cleanupCutoffs(NOW)).toEqual({
      sessions: new Date('2026-11-20T03:30:00.000Z'),
      tokens: new Date('2026-12-13T03:30:00.000Z'),
    });
  });
});

describe('SessionCleanup.run', () => {
  it('runs batches until one comes back short, sessions first, then tokens', async () => {
    const { cleanup } = harness([3, 3, 1, 2]);
    expect(await cleanup.run(NOW)).toEqual({ sessions: 7, tokens: 2, batches: 4, more: false });
  });

  it('stops at the cap with a full last batch and says more is left', async () => {
    const { cleanup } = harness([3, 3, 3, 0], { maxBatches: 3 });
    expect(await cleanup.run(NOW)).toEqual({ sessions: 9, tokens: 0, batches: 4, more: true });
  });

  it('bounds every batch with SET LOCAL statement_timeout before the DELETE', async () => {
    const { cleanup, sql, params } = harness([1, 0]);
    await cleanup.run(NOW);
    expect(sql.map((s) => (s.includes('set_config') ? 'timeout' : 'delete'))).toEqual([
      'timeout',
      'delete',
      'timeout',
      'delete',
    ]);
    expect(params[0]).toEqual(['4000']);
    expect(sql[0]).toContain("set_config('statement_timeout', ?, true)");
  });

  it('deletes by the cutoffs, a limited batch, and skips locked rows', async () => {
    const { cleanup, sql, params } = harness([0, 0]);
    await cleanup.run(NOW);
    const cut = cleanupCutoffs(NOW);
    expect(sql[1]).toMatch(/expires_at < \? OR revoked_at < \?/);
    expect(sql[1]).toContain('FOR UPDATE SKIP LOCKED');
    expect(params[1]).toEqual([cut.sessions, cut.sessions, 3]);
    expect(sql[3]).toContain('FROM auth_tokens');
    expect(params[3]).toEqual([cut.tokens, 3]);
  });

  it('audits counts only, once per run', async () => {
    const { cleanup, audit } = harness([2, 1]);
    await cleanup.run(NOW);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      action: 'housekeeping.session_cleanup',
      meta: { sessions: 2, tokens: 1, batches: 2, more: false },
    });
  });
});
