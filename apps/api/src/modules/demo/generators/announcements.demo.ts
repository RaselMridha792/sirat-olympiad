import { randomUUID } from 'node:crypto';
import { ANNOUNCEMENTS } from '../demo-names';
import type { DemoContext, DemoGenerator } from '../demo.types';

const DAY = 86_400_000;

/**
 * A few announcements for the student home (core's shape; core reviews it). They are for everyone (category NULL) and
 * marked with demo_batch_id, so demo_clear takes them. An announcement needs an author: the admin who started the
 * load, or for the CLI the oldest admin (an announcement is never written by a demo account, which is never an admin).
 */
export const announcementsDemoGenerator: DemoGenerator = {
  area: 'announcements',
  dependsOn: ['exams'],
  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('announcements');
    const batch = await ctx.tx.demoBatch.findUniqueOrThrow({
      where: { id: ctx.batchId },
      select: { createdById: true },
    });
    const authorId =
      batch.createdById ??
      (
        await ctx.tx.user.findFirst({
          where: { role: 'admin', demoBatchId: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!authorId) return; // no admin yet: no announcements (nothing else depends on them)
    const rows = ANNOUNCEMENTS.map((a, i) => {
      const at = new Date(ctx.now.getTime() - (ANNOUNCEMENTS.length - i) * 2 * DAY);
      return {
        id: randomUUID(),
        title: a.title,
        body: a.body,
        category: null,
        publishedAt: at,
        createdById: authorId,
        demoBatchId: ctx.batchId,
        createdAt: at,
        updatedAt: at,
      };
    });
    await ctx.tx.announcement.createMany({ data: rows });
    await ctx.register(
      'announcements',
      rows.map((r) => r.id),
    );
    ctx.count('announcements', rows.length);
  },
};
