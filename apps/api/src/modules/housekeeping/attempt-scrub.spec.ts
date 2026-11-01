import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { AttemptScrub, scrubCutoff } from './attempt-scrub';

/* The registration form's retention with a fake database (the real SQL runs in test/attempt-scrub.int-spec.ts). */

function harness(counts: number[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?').replace(/\s+/g, ' '));
      params.push(values);
      return Promise.resolve(counts.shift() ?? 0);
    }),
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => Promise<number>) => fn(tx) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const scrub = new AttemptScrub(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {
      batchSize: 3,
      maxBatches: 3,
      statementTimeoutMs: 4_000,
    },
  );
  return { scrub, sql, params, audit };
}

const NOW = new Date('2026-12-20T22:00:00.000Z');

it('the cutoff is 30 days back', () => {
  expect(scrubCutoff(NOW)).toEqual(new Date('2026-11-20T22:00:00.000Z'));
});

it('clears only the payload: abandoned by its last change, open only when no payment is alive', async () => {
  const { scrub, sql, params } = harness([2, 1]);
  expect(await scrub.run(NOW)).toEqual({ abandoned: 2, dead: 1, batches: 2, more: false });
  const cut = scrubCutoff(NOW);

  // The ids are picked once, in a MATERIALIZED CTE: an IN (subquery LIMIT n) can run more than once and pass n.
  expect(sql[0]).toContain('WITH batch AS MATERIALIZED (');
  expect(sql[0]).toContain(
    'UPDATE pending_registrations r SET payload = NULL FROM batch WHERE r.id = batch.id',
  );
  expect(sql[0]).toContain("status = 'abandoned' AND payload IS NOT NULL AND updated_at < ?");
  expect(sql[0]).toContain('FOR UPDATE SKIP LOCKED');
  expect(params[0]).toEqual([cut, 3]);

  expect(sql[1]).toContain("a.status = 'open' AND a.payload IS NOT NULL AND a.updated_at < ?");
  expect(sql[1]).toContain(
    "p.status IN ('initiated', 'pending', 'paid', 'refunded') OR p.expires_at >= ?",
  );
  expect(sql[1]).toContain('NOT EXISTS');
  expect(sql[1]).toContain('FOR UPDATE OF a SKIP LOCKED');
  expect(params[1]).toEqual([cut, cut, 3]);
  for (const s of sql) expect(s).not.toMatch(/conflict|completed|DELETE|WHERE id IN \(/);
});

it('audits counts only, once per run', async () => {
  const { scrub, audit } = harness([0, 0]);
  await scrub.run(NOW);
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(audit.record).toHaveBeenCalledWith({
    action: 'housekeeping.attempt_scrub',
    meta: { abandoned: 0, dead: 0, batches: 2, more: false },
  });
});
