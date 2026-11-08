import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { TEAM_LIMITS } from '@sirat/shared';
import { PROMO_ALPHABET } from '../../ambassadors/promo-code';
import { pointsPerReferral } from '../../ambassadors/referral-points';
import type { DemoContext, DemoGenerator, DemoUser } from '../demo.types';

const DAY = 86_400_000;
/** Of the paid demo students, this share came through a demo ambassador's code. */
const REFERRED_SHARE = 0.5;
const TEAMS = 5;

/** Demo tasks: titles 3-120, descriptions 1-2000, points 0-1000 (admin_tasks CHECKs, core's DTO). */
export const DEMO_TASKS = [
  {
    title: 'DEMO · Share the olympiad poster',
    description: 'Share the poster in two class or school groups and send a screenshot.',
    points: 20,
  },
  {
    title: 'DEMO · Bring three classmates',
    description: 'Help three classmates register with your code.',
    points: 30,
  },
  {
    title: 'DEMO · Write a short post about leadership',
    description: 'Write 100 words on a leader you admire and share the link.',
    points: 15,
  },
] as const;

const PROOFS = [
  'Shared in the class 9 and science club groups; screenshots in the drive folder.',
  'Posted on the school page: https://example.org/post/123',
  'Three classmates registered today with my code.',
];
const TEAM_WORDS = ['Padma', 'Meghna', 'Jamuna', 'Shapla', 'Bakul', 'Kadam', 'Shimul', 'Palash'];

/**
 * Ambassadors (core's area; DECISIONS "Demo data" D5): every demo ambassador approved with an SR- code (approval needs
 * a registration, so this runs after payments); half the paid demo students referred by one of them, with the points
 * worker's own referral rows (`referral_paid:<paymentId>`, so its sweep skips them); demo tasks with assignments in
 * every state and the points of the approved ones; teams of 3-10 with TM- codes. The tasks and the approvals need an
 * admin (ctx.adminId): without one they are skipped.
 */
export const ambassadorsDemoGenerator: DemoGenerator = {
  area: 'ambassadors',
  dependsOn: ['payments'],
  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('ambassadors');
    if (ctx.users.ambassadors.length === 0) return;
    await profiles(ctx);
    await referrals(ctx);
    if (ctx.adminId) await tasks(ctx, ctx.adminId);
    await teams(ctx);
  },
};

/** n codes of `prefix` + 6 Crockford characters that no row holds yet (promo-code.ts's format). */
async function freeCodes(ctx: DemoContext, prefix: string, n: number, taken: Set<string>) {
  const out: string[] = [];
  while (out.length < n) {
    let code = prefix;
    for (let i = 0; i < 6; i++) code += PROMO_ALPHABET[ctx.rng.int(PROMO_ALPHABET.length)];
    if (!taken.has(code.toUpperCase())) {
      taken.add(code.toUpperCase());
      out.push(code);
    }
  }
  return out;
}

async function profiles(ctx: DemoContext): Promise<void> {
  const taken = new Set(
    (await ctx.tx.ambassadorProfile.findMany({ select: { promoCode: true } })).map((p) =>
      p.promoCode.toUpperCase(),
    ),
  );
  const codes = await freeCodes(ctx, 'SR-', ctx.users.ambassadors.length, taken);
  const rows = ctx.users.ambassadors.map((a, i) => {
    const at = new Date(ctx.now.getTime() - (12 + ctx.rng.int(8)) * DAY);
    return {
      id: randomUUID(),
      userId: a.id,
      promoCode: codes[i]!,
      approvedAt: at,
      createdAt: at,
      updatedAt: at,
    };
  });
  await ctx.tx.ambassadorProfile.createMany({ data: rows });
  await ctx.register(
    'ambassador_profiles',
    rows.map((r) => r.id),
  );
}

/** Referred students and the referral points, as the points worker writes them (referral-points.ts). */
async function referrals(ctx: DemoContext): Promise<void> {
  const ambassadors = new Set(ctx.users.ambassadors.map((a) => a.id));
  const paid = await ctx.tx.registration.findMany({
    where: { user: { demoBatchId: ctx.batchId } },
    select: { userId: true, paymentId: true, createdAt: true },
  });
  const referred = paid.filter((r) => !ambassadors.has(r.userId) && ctx.rng.chance(REFERRED_SHARE));
  const points = await pointsPerReferral(ctx.tx);
  const rows: Prisma.PointLedgerCreateManyInput[] = [];
  for (const r of referred) {
    const by = ctx.rng.pick(ctx.users.ambassadors);
    await ctx.tx.user.update({ where: { id: r.userId }, data: { referredById: by.id } });
    if (points > 0)
      rows.push({
        id: randomUUID(),
        userId: by.id,
        eventKey: `referral_paid:${r.paymentId}`,
        amount: points,
        reason: 'referral',
        createdAt: new Date(r.createdAt.getTime() + 5 * 60_000),
      });
  }
  if (rows.length === 0) return;
  await ctx.tx.pointLedger.createMany({ data: rows });
  await ctx.register(
    'point_ledger',
    rows.map((r) => r.id as string),
  );
}

async function tasks(ctx: DemoContext, adminId: string): Promise<void> {
  const created = new Date(ctx.now.getTime() - 10 * DAY);
  const taskRows = DEMO_TASKS.map((t) => ({
    id: randomUUID(),
    ...t,
    createdById: adminId,
    demoBatchId: ctx.batchId,
    createdAt: created,
    updatedAt: created,
  }));
  await ctx.tx.adminTask.createMany({ data: taskRows });
  await ctx.register(
    'admin_tasks',
    taskRows.map((t) => t.id),
  );

  const assignments: Prisma.TaskAssignmentCreateManyInput[] = [];
  const points: Prisma.PointLedgerCreateManyInput[] = [];
  const states = ['assigned', 'submitted', 'approved', 'approved', 'rejected'] as const;
  for (const a of ctx.users.ambassadors) {
    for (const t of ctx.rng.shuffle(taskRows).slice(0, 1 + ctx.rng.int(3))) {
      const status = ctx.rng.pick(states);
      const id = randomUUID();
      const assignedAt = new Date(created.getTime() + ctx.rng.int(2 * DAY));
      const submittedAt = new Date(assignedAt.getTime() + (1 + ctx.rng.int(3)) * DAY);
      const reviewedAt = new Date(submittedAt.getTime() + DAY);
      assignments.push({
        id,
        taskId: t.id,
        userId: a.id,
        status,
        createdAt: assignedAt,
        updatedAt: status === 'assigned' ? assignedAt : reviewedAt,
        ...(status === 'assigned' ? {} : { proofText: ctx.rng.pick(PROOFS), submittedAt }),
        ...(status === 'approved' ? { approvedById: adminId, approvedAt: reviewedAt } : {}),
        ...(status === 'rejected'
          ? { reviewNote: 'Please add a screenshot of the shared post.' }
          : {}),
      });
      if (status === 'approved')
        points.push({
          id: randomUUID(),
          userId: a.id,
          eventKey: `task:${id}`,
          amount: t.points,
          reason: 'task',
          taskId: t.id,
          createdById: adminId,
          createdAt: reviewedAt,
        });
    }
  }
  await ctx.tx.taskAssignment.createMany({ data: assignments });
  await ctx.register(
    'task_assignments',
    assignments.map((a) => a.id as string),
  );
  if (points.length === 0) return;
  await ctx.tx.pointLedger.createMany({ data: points });
  await ctx.register(
    'point_ledger',
    points.map((p) => p.id as string),
  );
}

/** Teams of 3 to 10 (owner included, TEAM_LIMITS.maxMembers), each owned by an approved demo ambassador. */
async function teams(ctx: DemoContext): Promise<void> {
  const owners = ctx.rng
    .shuffle(ctx.users.ambassadors)
    .slice(0, Math.min(TEAMS, ctx.users.ambassadors.length));
  const ownerIds = new Set(owners.map((o) => o.id));
  const pool: DemoUser[] = ctx.rng.shuffle(ctx.users.students.filter((s) => !ownerIds.has(s.id)));
  const taken = new Set(
    (await ctx.tx.team.findMany({ select: { joinCode: true } })).map((t) =>
      t.joinCode.toUpperCase(),
    ),
  );
  const codes = await freeCodes(ctx, 'TM-', owners.length, taken);
  const names = ctx.rng.shuffle(TEAM_WORDS);
  const teamRows = owners.map((o, i) => {
    const at = new Date(ctx.now.getTime() - (6 + ctx.rng.int(4)) * DAY);
    return {
      id: randomUUID(),
      name: `DEMO · Team ${names[i % names.length]}${i >= names.length ? ` ${i}` : ''}`,
      joinCode: codes[i]!,
      ownerId: o.id,
      createdAt: at,
      updatedAt: at,
    };
  });
  await ctx.tx.team.createMany({ data: teamRows });
  await ctx.register(
    'teams',
    teamRows.map((t) => t.id),
  );
  // Members are deleted with their team (demo_clear); a (team, user) key does not fit the registry's 64 characters.
  const members: { teamId: string; userId: string; createdAt: Date; updatedAt: Date }[] = [];
  for (const t of teamRows) {
    members.push({
      teamId: t.id,
      userId: t.ownerId,
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
    });
    const extra = 2 + ctx.rng.int(TEAM_LIMITS.maxMembers - 2); // 2..9 more: 3..10 in all
    for (const s of pool.splice(0, extra)) {
      const at = new Date(t.createdAt.getTime() + (1 + ctx.rng.int(3)) * DAY);
      members.push({ teamId: t.id, userId: s.id, createdAt: at, updatedAt: at });
    }
  }
  await ctx.tx.teamMember.createMany({ data: members });
}
