/**
 * Ambassador tasks (core C5b-2, CORE-PLAN §6; lead 2026-11-01): admins create, edit, archive, assign and review; an
 * ambassador submits a plain-text proof for their own task; an approval awards the task's points once and is final; a
 * rejection lets the ambassador submit again; the proof never reaches an audit row; submits are rate-limited.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminTaskReviewRow,
  AdminTaskRow,
  AmbassadorOverview,
  Paginated,
  TaskAssignResult,
  TaskReviewResult,
} from '@sirat/shared';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeUser, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin' });
});

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const details = (json: unknown) => (json as { details?: string[] }).details;

/** A signed-in ambassador with an approved (or revoked) profile. */
async function ambassador(approved = true) {
  const s = await sessionFor(env, prisma, { role: approved ? 'ambassador' : 'student' });
  await prisma.ambassadorProfile.create({
    data: { userId: s.id, promoCode: newPromoCode(), approvedAt: approved ? new Date() : null },
  });
  return s;
}

async function task(points = 25, title = `Task ${randomUUID().slice(0, 8)}`) {
  const res = await call<AdminTaskRow>(env, 'POST', '/admin/tasks', admin.cookie, {
    title,
    description: 'Share the poster with your school.\nSend the link.',
    points,
  });
  expect(res.status).toBe(201);
  return res.json;
}

const assign = (taskId: string, userIds: string[]) =>
  call<TaskAssignResult>(env, 'POST', `/admin/tasks/${taskId}/assign`, admin.cookie, { userIds });

async function assignmentOf(taskId: string, userId: string) {
  return (
    await prisma.taskAssignment.findUniqueOrThrow({ where: { taskId_userId: { taskId, userId } } })
  ).id;
}

const submit = (cookie: string, assignmentId: string, proof: string) =>
  call(env, 'POST', `/ambassador/tasks/${assignmentId}/submit`, cookie, { proof });
const approve = (id: string) =>
  call<TaskReviewResult>(env, 'POST', `/admin/task-assignments/${id}/approve`, admin.cookie);
const reject = (id: string, note: string) =>
  call<TaskReviewResult>(env, 'POST', `/admin/task-assignments/${id}/reject`, admin.cookie, {
    note,
  });
const ledgerKey = (id: string) =>
  prisma.pointLedger.findMany({ where: { eventKey: `task:${id}` } });

describe('admin: tasks', () => {
  it('creates, edits with the version the admin saw, archives and restores; nothing is deleted', async () => {
    const t = await task(30);
    expect(t).toMatchObject({
      points: 30,
      archivedAt: null,
      counts: { assigned: 0, submitted: 0 },
    });
    expect(t.description).toBe('Share the poster with your school.\nSend the link.');
    const patch = (body: unknown) =>
      call<AdminTaskRow>(env, 'PATCH', `/admin/tasks/${t.id}`, admin.cookie, body);
    const edited = await patch({ points: 40, expectedUpdatedAt: t.updatedAt });
    expect([edited.status, edited.json.points]).toEqual([200, 40]);
    const stale = await patch({ points: 50, expectedUpdatedAt: t.updatedAt });
    expect([stale.status, details(stale.json)]).toEqual([409, ['stale']]);
    const same = await patch({ points: 40, expectedUpdatedAt: edited.json.updatedAt });
    expect([same.status, details(same.json)]).toEqual([409, ['nothing_to_update']]);

    const archived = await call<AdminTaskRow>(
      env,
      'POST',
      `/admin/tasks/${t.id}/archive`,
      admin.cookie,
    );
    expect(archived.json.archivedAt).not.toBeNull();
    const again = await call(env, 'POST', `/admin/tasks/${t.id}/archive`, admin.cookie);
    expect(details(again.json)).toEqual(['archived']);
    const late = await patch({ points: 10, expectedUpdatedAt: archived.json.updatedAt });
    expect(details(late.json)).toEqual(['archived']);
    const list = (status: string) =>
      call<Paginated<AdminTaskRow>>(
        env,
        'GET',
        `/admin/tasks?status=${status}&pageSize=50`,
        admin.cookie,
      );
    expect((await list('archived')).json.items.map((r) => r.id)).toContain(t.id);
    expect((await list('active')).json.items.map((r) => r.id)).not.toContain(t.id);
    const restored = await call<AdminTaskRow>(
      env,
      'POST',
      `/admin/tasks/${t.id}/restore`,
      admin.cookie,
    );
    expect(restored.json.archivedAt).toBeNull();
    expect(
      details((await call(env, 'POST', `/admin/tasks/${t.id}/restore`, admin.cookie)).json),
    ).toEqual(['not_archived']);
    expect(
      await prisma.auditLog.count({ where: { entityId: t.id, action: { startsWith: 'task.' } } }),
    ).toBe(4);
  });

  it('refuses a short title, too many points, an empty description, unknown fields and null', async () => {
    const base = { title: 'Poster week', description: 'Share it.', points: 10 };
    for (const body of [
      { ...base, title: 'ab' },
      { ...base, points: 1001 },
      { ...base, points: -1 },
      { ...base, description: '   ' },
      { ...base, extra: 1 },
    ])
      expect((await call(env, 'POST', '/admin/tasks', admin.cookie, body)).status).toBe(400);
    const t = await task();
    expect(
      (
        await call(env, 'PATCH', `/admin/tasks/${t.id}`, admin.cookie, {
          title: null,
          expectedUpdatedAt: t.updatedAt,
        })
      ).status,
    ).toBe(400);
  });

  it('assigns to approved, unblocked ambassadors only, each once', async () => {
    const t = await task();
    const a = await ambassador();
    const b = await ambassador();
    const revoked = await ambassador(false);
    const student = await makeUser(prisma, { role: 'student' });
    expect((await assign(t.id, [a.id, b.id])).json).toEqual({ assigned: 2, alreadyAssigned: 0 });
    expect((await assign(t.id, [a.id])).json).toEqual({ assigned: 0, alreadyAssigned: 1 });
    for (const ids of [[a.id, student.id], [revoked.id]]) {
      const res = await assign(t.id, ids);
      expect([res.status, details(res.json)]).toEqual([409, ['not_ambassador']]);
    }
    expect(await prisma.taskAssignment.count({ where: { taskId: t.id } })).toBe(2);
    expect((await assign(t.id, [a.id, a.id])).status).toBe(400);
    expect(
      (
        await assign(
          t.id,
          Array.from({ length: 51 }, () => randomUUID()),
        )
      ).status,
    ).toBe(400);
    await call(env, 'POST', `/admin/tasks/${t.id}/archive`, admin.cookie);
    expect(details((await assign(t.id, [b.id])).json)).toEqual(['archived']);
  });
});

describe('submit and review', () => {
  it('an ambassador submits proof, the admin approves once, and the points land once', async () => {
    const t = await task(25);
    const a = await ambassador();
    await assign(t.id, [a.id]);
    const id = await assignmentOf(t.id, a.id);
    const proof = 'https://example.org/poster-post';
    expect((await submit(a.cookie, id, proof)).status).toBe(204);

    const me = await call<AmbassadorOverview>(env, 'GET', '/ambassador/me', a.cookie);
    expect(me.json.tasks.find((x) => x.id === id)).toMatchObject({
      status: 'submitted',
      points: 25,
      reviewNote: null,
    });
    expect(JSON.stringify(me.json)).not.toContain(proof); // the panel never echoes the proof

    const queue = await call<Paginated<AdminTaskReviewRow>>(
      env,
      'GET',
      '/admin/task-assignments?pageSize=50',
      admin.cookie,
    );
    expect(queue.json.items.find((r) => r.assignmentId === id)).toMatchObject({
      taskId: t.id,
      points: 25,
      proof,
      ambassador: { userId: a.id },
    });

    const ok = await approve(id);
    expect([ok.status, ok.json]).toEqual([
      200,
      { assignmentId: id, status: 'approved', points: 25 },
    ]);
    const twice = await approve(id);
    expect([twice.status, details(twice.json)]).toEqual([409, ['not_submitted']]);
    const rows = await ledgerKey(id);
    expect(rows.map((r) => [r.amount, r.taskId, r.createdById])).toEqual([[25, t.id, admin.id]]);
    expect(details((await submit(a.cookie, id, 'again')).json)).toEqual(['not_open']);
  });

  it('three approvals at once award the points once', async () => {
    const t = await task(15);
    const a = await ambassador();
    await assign(t.id, [a.id]);
    const id = await assignmentOf(t.id, a.id);
    await submit(a.cookie, id, 'Proof');
    const statuses = (await Promise.all([approve(id), approve(id), approve(id)]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(await ledgerKey(id)).toHaveLength(1);
  });

  it('a rejection with a note lets the ambassador submit again; the proof and note never reach an audit row', async () => {
    const t = await task();
    const a = await ambassador();
    await assign(t.id, [a.id]);
    const id = await assignmentOf(t.id, a.id);
    const marker = `PROOF_${randomUUID().slice(0, 8)}`;
    await submit(a.cookie, id, `${marker} first try`);
    const no = await reject(id, 'The link does not open');
    expect(no.json).toEqual({ assignmentId: id, status: 'rejected', points: null });
    const me = await call<AmbassadorOverview>(env, 'GET', '/ambassador/me', a.cookie);
    expect(me.json.tasks.find((x) => x.id === id)).toMatchObject({
      status: 'rejected',
      reviewNote: 'The link does not open',
    });
    expect((await submit(a.cookie, id, `${marker} second try`)).status).toBe(204);
    expect(details((await reject(id, 'ab')).json)).toBeDefined(); // a note of 3+ characters is required
    expect((await reject(id, 'ab')).status).toBe(400);
    const audits = await prisma.auditLog.findMany({ where: { entityId: t.id } });
    expect(audits.map((r) => r.action).sort()).toEqual(
      ['task.assigned', 'task.created', 'task.rejected', 'task.submitted', 'task.submitted'].sort(),
    );
    const text = JSON.stringify(audits.map((r) => r.meta));
    expect(text).not.toContain(marker);
    expect(text).not.toContain('does not open');
  });

  it('an ambassador submits only their own open task, never an archived one, and not once revoked', async () => {
    const t = await task();
    const a = await ambassador();
    const b = await ambassador();
    await assign(t.id, [a.id, b.id]);
    const ida = await assignmentOf(t.id, a.id);
    expect((await submit(b.cookie, ida, 'Not mine')).status).toBe(404);
    expect((await submit(a.cookie, randomUUID(), 'Nothing')).status).toBe(404);
    for (const proof of ['', '   ', 'x'.repeat(1001)])
      expect((await submit(a.cookie, ida, proof)).status).toBe(400);

    await call(env, 'POST', `/admin/tasks/${t.id}/archive`, admin.cookie);
    expect(details((await submit(a.cookie, ida, 'Late')).json)).toEqual(['archived']);
    await call(env, 'POST', `/admin/tasks/${t.id}/restore`, admin.cookie);

    await prisma.ambassadorProfile.update({ where: { userId: a.id }, data: { approvedAt: null } });
    await prisma.user.update({ where: { id: a.id }, data: { role: 'student' } });
    expect((await submit(a.cookie, ida, 'Revoked')).status).toBe(403); // the token still says ambassador
    const student = await sessionFor(env, prisma, { role: 'student' });
    expect((await submit(student.cookie, ida, 'Student')).status).toBe(403);
    expect(await prisma.taskAssignment.findUniqueOrThrow({ where: { id: ida } })).toMatchObject({
      status: 'assigned',
      proofText: null,
    });
  });

  it('limits proof submissions per ambassador', async () => {
    const t = await task();
    const a = await ambassador();
    await assign(t.id, [a.id]);
    const id = await assignmentOf(t.id, a.id);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await submit(a.cookie, id, `Try ${i}`)).status);
    expect(statuses[0]).toBe(204);
    expect(statuses.slice(1, 10).every((s) => s === 409)).toBe(true); // not open again until reviewed
    expect(statuses[10]).toBe(429);
  });
});

describe('who may manage tasks', () => {
  it('is for admins only: manager, ambassador and student get 403', async () => {
    const t = await task();
    for (const role of ['manager', 'ambassador', 'student'] as const) {
      const other = await sessionFor(env, prisma, { role });
      for (const [method, path] of [
        ['GET', '/admin/tasks'],
        ['GET', '/admin/task-assignments'],
        ['POST', `/admin/tasks/${t.id}/archive`],
        ['POST', `/admin/task-assignments/${randomUUID()}/approve`],
      ] as const)
        expect([role, path, (await call(env, method, path, other.cookie)).status]).toEqual([
          role,
          path,
          403,
        ]);
    }
  });
});

describe('database rules', () => {
  it('refuses a task or an assignment outside the limits and the status rules', async () => {
    const owner = await makeUser(prisma, { role: 'admin' });
    const bad = async (fn: () => Promise<unknown>, constraint: string) =>
      expect(fn()).rejects.toMatchObject({ message: expect.stringContaining(constraint) });
    await bad(
      () =>
        prisma.adminTask.create({
          data: { title: 'ab', description: 'd', points: 1, createdById: owner.id },
        }),
      'admin_tasks_title_check',
    );
    await bad(
      () =>
        prisma.adminTask.create({
          data: { title: 'Task', description: 'd', points: 1001, createdById: owner.id },
        }),
      'admin_tasks_points_check',
    );
    const t = await prisma.adminTask.create({
      data: { title: 'Task', description: 'd', points: 5, createdById: owner.id },
    });
    const u = await makeUser(prisma, { role: 'ambassador' });
    await bad(
      () =>
        prisma.taskAssignment.create({ data: { taskId: t.id, userId: u.id, status: 'submitted' } }),
      'task_assignments_submitted_check',
    );
    await bad(
      () =>
        prisma.taskAssignment.create({
          data: {
            taskId: t.id,
            userId: u.id,
            status: 'approved',
            proofText: 'p',
            submittedAt: new Date(),
          },
        }),
      'task_assignments_approved_check',
    );
    await bad(
      () =>
        prisma.taskAssignment.create({
          data: {
            taskId: t.id,
            userId: u.id,
            status: 'rejected',
            proofText: 'p',
            submittedAt: new Date(),
          },
        }),
      'task_assignments_rejected_check',
    );
  });
});
