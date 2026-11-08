import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TaskStatus } from '@prisma/client';
import type {
  AdminTaskInput,
  AdminTaskPatch,
  AdminTaskReviewRow,
  AdminTaskRow,
  Paginated,
  TaskAssignResult,
  TaskListStatus,
  TaskReviewResult,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from './ambassadors.service';

type Tx = Prisma.TransactionClient;
const DEFAULT_PAGE_SIZE = 20;
const COUNTED: readonly TaskStatus[] = ['assigned', 'submitted', 'approved', 'rejected'];
const conflict = (code: string) => new ConflictException([code]);

/** The query strings as the DTOs pass them (every field optional). */
type PageParams = { page?: number; pageSize?: number };

/**
 * Ambassador tasks (core C5b-2, CORE-PLAN §6; lead's plan and rules). Admins create, assign and review; an ambassador
 * submits a plain-text proof for their own assignment. An approval writes one ledger row `task:<assignmentId>`
 * (never twice) and is final; a mistaken award is corrected with a compensating adjustment (C5b-1). The proof is a
 * minor's free text: it is never logged and never written to an audit row (those keep ids and statuses only).
 */
@Injectable()
export class AmbassadorTasksService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── Admin: tasks ─────────────

  async list(
    actorId: string,
    q: PageParams & { status?: TaskListStatus },
  ): Promise<Paginated<AdminTaskRow>> {
    await assertAdmin(this.prisma, actorId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.AdminTaskWhereInput =
      q.status === 'archived' ? { archivedAt: { not: null } } : { archivedAt: null };
    const [total, tasks] = await Promise.all([
      this.prisma.adminTask.count({ where }),
      this.prisma.adminTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const groups = tasks.length
      ? await this.prisma.taskAssignment.groupBy({
          by: ['taskId', 'status'],
          where: { taskId: { in: tasks.map((t) => t.id) } },
          _count: { _all: true },
        })
      : [];
    return {
      items: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        points: t.points,
        archivedAt: t.archivedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        demo: t.demoBatchId !== null,
        counts: Object.fromEntries(
          COUNTED.map((s) => [
            s,
            groups.find((g) => g.taskId === t.id && g.status === s)?._count._all ?? 0,
          ]),
        ) as AdminTaskRow['counts'],
      })),
      page,
      pageSize,
      total,
    };
  }

  async create(body: AdminTaskInput, actor: Actor): Promise<AdminTaskRow> {
    await assertAdmin(this.prisma, actor.id);
    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adminTask.create({
        data: {
          title: body.title,
          description: body.description,
          points: body.points,
          createdById: actor.id,
        },
      });
      await audit(tx, actor, 'task.created', created.id, { points: created.points });
      return created;
    });
    return toRow(task);
  }

  async patch(id: string, body: AdminTaskPatch, actor: Actor): Promise<AdminTaskRow> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const task = await lockTask(tx, id);
      if (task.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString())
        throw conflict('stale');
      if (task.archivedAt) throw conflict('archived');
      const data: Prisma.AdminTaskUpdateInput = {};
      if (body.title !== undefined && body.title !== task.title) data.title = body.title;
      if (body.description !== undefined && body.description !== task.description)
        data.description = body.description;
      if (body.points !== undefined && body.points !== task.points) data.points = body.points;
      const changed = Object.keys(data);
      if (changed.length === 0) throw conflict('nothing_to_update');
      const updated = await tx.adminTask.update({ where: { id }, data });
      await audit(tx, actor, 'task.updated', id, { changed });
      return toRow(updated);
    });
  }

  async setArchived(id: string, archived: boolean, actor: Actor): Promise<AdminTaskRow> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const task = await lockTask(tx, id);
      if (archived && task.archivedAt) throw conflict('archived');
      if (!archived && !task.archivedAt) throw conflict('not_archived');
      const updated = await tx.adminTask.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await audit(tx, actor, archived ? 'task.archived' : 'task.restored', id, {});
      return toRow(updated);
    });
  }

  /** Approved, unblocked ambassadors only; an ambassador who has the task already is skipped. */
  async assign(id: string, userIds: string[], actor: Actor): Promise<TaskAssignResult> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const task = await lockTask(tx, id);
      if (task.archivedAt) throw conflict('archived');
      const eligible = await tx.user.count({
        where: {
          id: { in: userIds },
          role: 'ambassador',
          isBlocked: false,
          ambassador: { approvedAt: { not: null } },
        },
      });
      if (eligible !== userIds.length) throw conflict('not_ambassador');
      // Demo data never mixes with real data (DECISIONS 2026-11-08 "Demo data"): a demo task goes only to demo
      // ambassadors and a real task only to real ones. One on the other side refuses the whole call; the
      // task_assignments trigger is the backstop.
      const otherSide = await tx.user.count({
        where: {
          id: { in: userIds },
          demoBatchId: task.demoBatchId === null ? { not: null } : null,
        },
      });
      if (otherSide > 0) throw conflict('task_side_mismatch');
      const created = await tx.taskAssignment.createMany({
        data: userIds.map((userId) => ({ taskId: id, userId })),
        skipDuplicates: true,
      });
      const result = { assigned: created.count, alreadyAssigned: userIds.length - created.count };
      await audit(tx, actor, 'task.assigned', id, result);
      return result;
    });
  }

  // ───────────── Admin: review ─────────────

  async reviewQueue(actorId: string, q: PageParams): Promise<Paginated<AdminTaskReviewRow>> {
    await assertAdmin(this.prisma, actorId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.TaskAssignmentWhereInput = { status: 'submitted' };
    const [total, rows] = await Promise.all([
      this.prisma.taskAssignment.count({ where }),
      this.prisma.taskAssignment.findMany({
        where,
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], // oldest first: the queue is worked from the top
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          proofText: true,
          submittedAt: true,
          task: { select: { id: true, title: true, points: true, demoBatchId: true } },
          user: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        assignmentId: r.id,
        taskId: r.task.id,
        taskTitle: r.task.title,
        points: r.task.points,
        ambassador: { userId: r.user.id, name: r.user.name },
        proof: r.proofText ?? '',
        submittedAt: (r.submittedAt ?? new Date(0)).toISOString(),
        demo: r.task.demoBatchId !== null,
      })),
      page,
      pageSize,
      total,
    };
  }

  /** Final. The ledger row's event key makes a second approval of the same assignment award nothing. */
  async approve(assignmentId: string, actor: Actor): Promise<TaskReviewResult> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const a = await lockAssignment(tx, assignmentId);
      if (a.status !== 'submitted') throw conflict('not_submitted');
      await tx.pointLedger.createMany({
        data: [
          {
            userId: a.userId,
            eventKey: `task:${a.id}`,
            amount: a.task.points,
            reason: 'task',
            taskId: a.taskId,
            createdById: actor.id,
          },
        ],
        skipDuplicates: true,
      });
      await tx.taskAssignment.update({
        where: { id: a.id },
        data: { status: 'approved', approvedById: actor.id, approvedAt: new Date() },
      });
      await audit(tx, actor, 'task.approved', a.taskId, { assignmentId: a.id, status: 'approved' });
      const sum = await tx.pointLedger.aggregate({
        where: { userId: a.userId },
        _sum: { amount: true },
      });
      return { assignmentId: a.id, status: 'approved' as const, points: sum._sum.amount ?? 0 };
    });
  }

  async reject(assignmentId: string, note: string, actor: Actor): Promise<TaskReviewResult> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const a = await lockAssignment(tx, assignmentId);
      if (a.status !== 'submitted') throw conflict('not_submitted');
      await tx.taskAssignment.update({
        where: { id: a.id },
        data: { status: 'rejected', reviewNote: note },
      });
      await audit(tx, actor, 'task.rejected', a.taskId, { assignmentId: a.id, status: 'rejected' });
      return { assignmentId: a.id, status: 'rejected' as const, points: null };
    });
  }

  // ───────────── Ambassador ─────────────

  /** Own assignment only (another's is 404); from assigned or rejected; never for an archived task. */
  async submit(
    userId: string,
    assignmentId: string,
    proof: string,
    ip: string | null,
  ): Promise<void> {
    await assertActiveAmbassador(this.prisma, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "task_assignments" WHERE "id" = ${assignmentId}::uuid FOR UPDATE`;
      const a = await tx.taskAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          userId: true,
          status: true,
          taskId: true,
          task: { select: { archivedAt: true } },
        },
      });
      if (!a || a.userId !== userId) throw new NotFoundException('Task not found');
      if (a.task.archivedAt) throw conflict('archived');
      if (a.status !== 'assigned' && a.status !== 'rejected') throw conflict('not_open');
      await tx.taskAssignment.update({
        where: { id: a.id },
        data: { status: 'submitted', proofText: proof, submittedAt: new Date(), reviewNote: null },
      });
      // Ids and status only: the proof never reaches an audit row.
      await audit(tx, { id: userId, ip }, 'task.submitted', a.taskId, {
        assignmentId: a.id,
        status: 'submitted',
      });
    });
  }
}

function toRow(t: {
  id: string;
  title: string;
  description: string;
  points: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  demoBatchId: string | null;
}): AdminTaskRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    points: t.points,
    archivedAt: t.archivedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    counts: { assigned: 0, submitted: 0, approved: 0, rejected: 0 },
    demo: t.demoBatchId !== null,
  };
}

async function lockTask(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT 1 FROM "admin_tasks" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const task = await tx.adminTask.findUnique({ where: { id } });
  if (!task) throw new NotFoundException('Task not found');
  return task;
}

async function lockAssignment(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT 1 FROM "task_assignments" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const a = await tx.taskAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      taskId: true,
      status: true,
      task: { select: { points: true } },
    },
  });
  if (!a) throw new NotFoundException('Task assignment not found');
  return a;
}

function audit(tx: Tx, actor: Actor, action: string, taskId: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: {
      action,
      actorId: actor.id,
      entityType: 'admin_task',
      entityId: taskId,
      ip: actor.ip,
      meta,
    },
  });
}

/** Roles come from the token (15 min); every admin call re-reads them, so a demoted or blocked admin stops at once. */
async function assertAdmin(db: Tx | PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}

/** As for the panel: a revoked or blocked ambassador with an older token is refused. */
async function assertActiveAmbassador(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true, ambassador: { select: { approvedAt: true } } },
  });
  if (!user || user.isBlocked || user.role !== 'ambassador' || !user.ambassador?.approvedAt)
    throw new ForbiddenException('Forbidden resource');
}
