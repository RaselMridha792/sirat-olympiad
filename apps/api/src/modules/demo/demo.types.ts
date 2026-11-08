import type { Prisma } from '@prisma/client';
import type { Category, Role } from '@sirat/shared';

/*
 * The demo data framework's contract (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"). Each area
 * writes one generator; the framework runs them in dependency order inside ONE transaction, and every row they insert
 * is registered in demo_records. Removal is the SQL function demo_clear(batch), never TypeScript: it deletes only rows
 * that are registered AND whose root (a demo user, exam or announcement: demo_batch_id, written only by the loader)
 * belongs to the batch.
 */

export { DEMO_EMAIL_DOMAIN } from '@sirat/shared';

/** A demo account the users generator made; the later generators attach to these (never make their own users). */
export interface DemoUser {
  id: string;
  /** Always ends with DEMO_EMAIL_DOMAIN. */
  email: string;
  /** ^01[3-9]\d{8}$, unique among the demo users. */
  phone: string;
  name: string;
  role: Extract<Role, 'student' | 'ambassador' | 'jury'>;
  district: string;
  institution: string;
  educationType: string;
  gradeLevelId: string | null;
  category: Category | null;
}

/** Seeded (mulberry32): the same seed gives the same data, so a load is reproducible and needs no faker. */
export interface DemoRandom {
  /** An integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** n random decimal digits. */
  digits(n: number): string;
}

export interface DemoContext {
  /** The ONE load transaction: use only this, never the PrismaService. */
  tx: Prisma.TransactionClient;
  batchId: string;
  /** The load's clock: every date a generator writes lies before it. */
  now: Date;
  rng: DemoRandom;
  /** The demo logins' password hash (argon2id with the API's parameters); only the users generator needs it. */
  passwordHash: string;
  /** Filled by the users generator, before every generator that depends on 'users'. */
  users: { students: DemoUser[]; ambassadors: DemoUser[]; jury: DemoUser[] };
  /** The demo exams, filled by the exams generator. */
  exams: { practice: string | null; round1: string | null };
  /** Registers inserted rows: the Postgres table name and the ids as strings (any batch size). */
  register(table: string, ids: readonly string[]): Promise<void>;
  /** Adds to a count the admin card shows, e.g. count('payments', 312). */
  count(key: string, n: number): void;
  /** A short step name for the job's progress. */
  progress(step: string): Promise<void>;
}

export interface DemoGenerator {
  /** The area's name, e.g. 'payments'. */
  readonly area: string;
  /** Areas that must run first, e.g. ['users']. */
  readonly dependsOn: readonly string[];
  load(ctx: DemoContext): Promise<void>;
}
