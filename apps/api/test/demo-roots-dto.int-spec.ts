/**
 * The demo root marker on tasks and rounds (DECISIONS 2026-11-08 "Demo data", phase 2) is written only by the demo
 * loader: the admin endpoints that create a task or a round refuse a body that names `demoBatchId` (whitelist with
 * forbidNonWhitelisted), so no request can make a real row look like demo data or the other way round.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin' });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

describe('the demo marker cannot be set through the API', () => {
  it('POST /admin/tasks with demoBatchId: 400, nothing created', async () => {
    const title = `Share ${randomUUID().slice(0, 8)}`;
    const res = await call(env, 'POST', '/admin/tasks', admin.cookie, {
      title,
      description: 'Share the poster',
      points: 5,
      demoBatchId: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(await prisma.adminTask.count({ where: { title } })).toBe(0);
  });

  it('POST /admin/rounds with demoBatchId: 400, nothing created', async () => {
    const name = `Final ${randomUUID().slice(0, 6)}`;
    const res = await call(env, 'POST', '/admin/rounds', admin.cookie, {
      name,
      type: 'final',
      demoBatchId: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(await prisma.round.count({ where: { name } })).toBe(0);
  });
});
