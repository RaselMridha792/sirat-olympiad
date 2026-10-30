/**
 * The first-admin CLI against the *_test database: the real script runs as a child process with the password on
 * stdin; the admin it creates then logs in through the real API.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { createAdmin } from '../src/cli/create-admin';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { makeUser, testPrisma } from './helpers';

const PASSWORD = 'Quiet-harbour-lamp-58';
const prisma: PrismaClient = testPrisma();
const apiDir = join(__dirname, '..');

afterAll(async () => {
  await prisma.$disconnect();
});

const email = () => `admin-${randomUUID().slice(0, 8)}@test.invalid`;

/** Runs the real CLI (TypeScript through tsx, no shell: arguments with spaces stay whole) with stdin piped. */
const tsxCli = require.resolve('tsx/cli', { paths: [apiDir] });
function cli(args: string[], stdin: string) {
  const r = spawnSync(process.execPath, [tsxCli, 'src/cli/create-admin.ts', ...args], {
    cwd: apiDir,
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('create-admin CLI', () => {
  it('creates a verified admin with an argon2id hash and an audit row, printing only its id', async () => {
    const address = email();
    const { code, out } = cli(
      ['--email', address.toUpperCase(), '--name', 'Ops Admin'],
      `${PASSWORD}\n`,
    );
    expect(code).toBe(0);
    const id = /Admin created: ([0-9a-f-]{36})/.exec(out)?.[1];
    expect(id).toBeDefined();
    expect(out).not.toContain(PASSWORD);
    expect(out.toLowerCase()).not.toContain(address);

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ email: address, name: 'Ops Admin', role: 'admin' });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await new PasswordService().verify(user.passwordHash, PASSWORD)).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.created', entityId: id },
    });
    expect(audit.meta).toEqual({ via: 'cli' });
  });

  it('refuses a common password and creates nothing', () => {
    const address = email();
    const { code, out } = cli(['--email', address, '--name', 'Ops'], '12345678\n');
    expect(code).toBe(1);
    expect(out).toContain('too common');
    return expect(prisma.user.count({ where: { email: address } })).resolves.toBe(0);
  });

  it('refuses a password passed as an argument without touching the database', () => {
    const { code, out } = cli(['--email', email(), '--name', 'Ops', '--password', PASSWORD], '');
    expect(code).toBe(2);
    expect(out).not.toContain(PASSWORD);
  });

  it('never changes an existing account with the same email', async () => {
    const existing = await makeUser(prisma, { email: email(), role: 'student' });
    await expect(
      createAdmin(prisma, { email: existing.email, name: 'Takeover' }, PASSWORD),
    ).rejects.toThrow(/already exists/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after).toMatchObject({
      role: 'student',
      name: existing.name,
      passwordHash: existing.passwordHash,
    });
  });

  it('creates an admin who can log in through the real API and is seen as admin', async () => {
    process.env.LOG_LEVEL = 'silent';
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/configure-app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    try {
      const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
      const address = email();
      await createAdmin(prisma, { email: address, name: 'Ops Admin' }, PASSWORD);
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-forwarded-for': `2001:db8:${randomUUID().slice(0, 4)}::1`,
        },
        body: JSON.stringify({ email: address, password: PASSWORD }),
      });
      expect(login.status).toBe(204);
      const cookie = login.headers
        .getSetCookie()
        .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
        ?.split(';')[0];
      const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookie ?? '' } });
      expect(await me.json()).toMatchObject({ email: address, role: 'admin' });
    } finally {
      await app.close();
    }
  }, 60_000);
});
