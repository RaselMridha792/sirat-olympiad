import { databaseRoleProblem } from './prisma.service';

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
