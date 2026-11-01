import { Logger } from '@nestjs/common';
import { PrismaService, databaseRoleProblem } from './prisma.service';

describe('PrismaService: the database role at boot (LAUNCH-PLAN L8)', () => {
  it('refuses a superuser in production, naming the rule', () => {
    expect(databaseRoleProblem({ name: 'sirat', superuser: true }, 'production')).toMatch(
      /refusing to start: .*superuser sirat; DATABASE_URL must use sirat_app/,
    );
  });

  it('starts as sirat_app in production, and as anything in development and tests', () => {
    expect(databaseRoleProblem({ name: 'sirat_app', superuser: false }, 'production')).toBeNull();
    expect(databaseRoleProblem({ name: 'sirat', superuser: true }, 'development')).toBeNull();
    expect(databaseRoleProblem({ name: 'sirat', superuser: true }, 'test')).toBeNull();
    expect(databaseRoleProblem({ name: 'sirat', superuser: true }, undefined)).toBeNull();
  });
});

describe('PrismaService.onModuleInit', () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    jest.restoreAllMocks();
  });

  /** A service whose connection and role query are stubbed: nothing reaches a database. */
  function service(role: { name: string; superuser: boolean }): PrismaService {
    process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused_test';
    const prisma = new PrismaService();
    jest.spyOn(prisma, '$connect').mockResolvedValue(undefined);
    jest.spyOn(prisma, '$queryRaw' as never).mockResolvedValue([role] as never);
    return prisma;
  }

  it('logs the boot line, then refuses to finish booting in production as a superuser', async () => {
    process.env.NODE_ENV = 'production';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(service({ name: 'sirat', superuser: true }).onModuleInit()).rejects.toThrow(
      /refusing to start/,
    );
    expect(log).toHaveBeenCalledWith('database role=sirat superuser=true');
  });

  it('boots in production as sirat_app', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(
      service({ name: 'sirat_app', superuser: false }).onModuleInit(),
    ).resolves.toBeUndefined();
  });
});
