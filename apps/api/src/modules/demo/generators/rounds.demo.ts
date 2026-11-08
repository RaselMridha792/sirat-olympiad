import { randomUUID } from 'node:crypto';
import { DEFAULT_VIDEO_CRITERIA } from '@sirat/shared';
import { DemoRefusalError } from '../demo-batches';
import type { DemoContext, DemoGenerator } from '../demo.types';

const DAY = 86_400_000;

/** The demo's own rounds: 101-110 is the demo range (rounds_sort_order_check); real rounds keep 1-10. */
export const DEMO_ROUND_SORT = { r1: 101, video: 102, final: 103 } as const;

/**
 * The demo's own rounds (DECISIONS "Demo data" 8, the lead's design): a Round 1 (quiz) that the demo Round 1 exam
 * belongs to, a video round whose window closed two days ago (so the jury could score), and a final. No demo row ever
 * references a real round. Refused (`real_rounds_present`) unless the real rounds are exactly Round 1: a demo final
 * beside a real one would give the admin pages two finals (core).
 */
export const roundsDemoGenerator: DemoGenerator = {
  area: 'rounds',
  dependsOn: [],
  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('rounds');
    const real = await ctx.tx.round.findMany({
      where: { demoBatchId: null },
      select: { sortOrder: true },
    });
    if (real.some((r) => r.sortOrder !== 1)) throw new DemoRefusalError('real_rounds_present');
    const now = ctx.now.getTime();
    const base = { demoBatchId: ctx.batchId, createdAt: new Date(now - 20 * DAY) };
    const r1 = {
      ...base,
      id: randomUUID(),
      name: 'DEMO · Round 1',
      sortOrder: DEMO_ROUND_SORT.r1,
      type: 'quiz' as const,
    };
    const video = {
      ...base,
      id: randomUUID(),
      name: 'DEMO · Round 2 (video)',
      sortOrder: DEMO_ROUND_SORT.video,
      type: 'video' as const,
      opensAt: new Date(now - 8 * DAY),
      closesAt: new Date(now - 2 * DAY),
      criteria: DEFAULT_VIDEO_CRITERIA.map((c) => ({ key: c.key, en: c.en, bn: c.bn })),
    };
    const final = {
      ...base,
      id: randomUUID(),
      name: 'DEMO · Final',
      sortOrder: DEMO_ROUND_SORT.final,
      type: 'final' as const,
    };
    for (const data of [r1, video, final]) await ctx.tx.round.create({ data });
    await ctx.register('rounds', [r1.id, video.id, final.id]);
    ctx.rounds = { r1: r1.id, video: video.id, final: final.id };
  },
};
