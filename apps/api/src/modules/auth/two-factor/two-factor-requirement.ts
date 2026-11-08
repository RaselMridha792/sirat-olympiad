import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Role } from '@sirat/shared';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TWO_FACTOR_ROLES, TwoFactorConfig } from './two-factor.config';
import { requirementChanged } from './two-factor.errors';

/*
 * The admin two-factor REQUIREMENT (DECISIONS 2026-11-08 "The admin 2FA requirement is a setting"). Which enrollable
 * roles must prove a second factor on the admin routes is the settings row below, a JSON array within
 * TWO_FACTOR_ROLES (a DB CHECK holds it there). It drives only the guard's 403 TWO_FACTOR_REQUIRED and the `required`
 * flags of GET /auth/2fa and /auth/me. The login's code step does not read it: an enrolled admin or manager always
 * gets the code step. Changing it never touches an enrolment, a secret, a recovery code or a session. A missing or
 * unreadable row, or a failed read, counts as "every enrollable role" (fail closed).
 */

/** The settings key (the seed inserts the default when the row is missing; the generic settings PUT refuses it). */
export const REQUIREMENT_KEY = 'two_factor_required_roles';
/**
 * How long one replica trusts what it read. A change through the endpoint drops that replica's copy at once; the
 * other replicas (and a change from the CLI) are picked up within this time. No logout, no token change.
 */
export const REQUIREMENT_CACHE_MS = 5000;
/** The default, and what a missing or unreadable row means. */
export const DEFAULT_REQUIRED_ROLES: readonly Role[] = TWO_FACTOR_ROLES;

/** Known roles only, without duplicates, in the order of TWO_FACTOR_ROLES: the form sets are stored and compared in. */
export function normalizeRoles(roles: readonly Role[]): Role[] {
  return TWO_FACTOR_ROLES.filter((role) => roles.includes(role));
}

/** The stored value as roles; null when it is not an array of enrollable roles (the CHECK refuses that). */
export function parseRequiredRoles(value: unknown): Role[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string' && TWO_FACTOR_ROLES.includes(v as Role)))
    return null;
  return normalizeRoles(value as Role[]);
}

/** One word for an alert or the CLI: `admin,manager`, `admin`, or `none`. */
export const rolesLabel = (roles: readonly Role[]): string =>
  roles.length > 0 ? roles.join(',') : 'none';

const sameRoles = (a: readonly Role[], b: readonly Role[]) =>
  rolesLabel(normalizeRoles(a)) === rolesLabel(normalizeRoles(b));

export interface RequirementChange {
  to: readonly Role[];
  /** The set the admin's form showed: 409 TWO_FACTOR_REQUIREMENT_CHANGED unless it is still the current one. */
  expected?: readonly Role[];
  /** Null for the break-glass CLI (an operator at the server). */
  actorId: string | null;
  ip?: string | null;
  /** Audited next to from and to: the reason, and `via: 'cli'` for the CLI. */
  meta: Record<string, string>;
}

export interface RequirementChanged {
  from: Role[];
  to: Role[];
  updatedAt: Date;
  /** False when `to` was already the current set: then nothing was written or audited. */
  changed: boolean;
}

/**
 * Writes the requirement inside the caller's transaction (the admin endpoint and the CLI). The row is inserted with
 * the default when missing and then locked, so two writers always meet on it; `expected` must still be the current
 * set; then the value and its audit row `security.two_factor_requirement_changed` ({ from, to, ...meta }). The caller
 * raises the alert after the commit.
 */
export async function applyRequirementChange(
  tx: Prisma.TransactionClient,
  change: RequirementChange,
): Promise<RequirementChanged> {
  await tx.$executeRaw`
    INSERT INTO "settings" ("key", "value", "created_at", "updated_at")
    VALUES (${REQUIREMENT_KEY}, ${JSON.stringify(DEFAULT_REQUIRED_ROLES)}::jsonb, now(), now())
    ON CONFLICT ("key") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ value: unknown; updated_at: Date }[]>`
    SELECT "value", "updated_at" FROM "settings" WHERE "key" = ${REQUIREMENT_KEY} FOR UPDATE`;
  const from = parseRequiredRoles(row?.value) ?? [...DEFAULT_REQUIRED_ROLES];
  if (change.expected !== undefined && !sameRoles(change.expected, from))
    throw requirementChanged();
  const to = normalizeRoles(change.to);
  if (sameRoles(from, to))
    return { from, to, updatedAt: row?.updated_at ?? new Date(), changed: false };
  const [written] = await tx.$queryRaw<{ updated_at: Date }[]>`
    UPDATE "settings" SET "value" = ${JSON.stringify(to)}::jsonb, "updated_at" = now()
    WHERE "key" = ${REQUIREMENT_KEY}
    RETURNING "updated_at"`;
  await tx.auditLog.create({
    data: {
      action: 'security.two_factor_requirement_changed',
      actorId: change.actorId,
      ip: change.ip ?? null,
      entityType: 'setting',
      entityId: REQUIREMENT_KEY,
      meta: { from, to, ...change.meta },
    },
  });
  return { from, to, updatedAt: written?.updated_at ?? new Date(), changed: true };
}

/** GET /admin/security/two-factor-requirement. */
export interface TwoFactorRequirementView {
  roles: Role[];
  /** When the row last changed (ISO); null while the row is missing (the default applies). */
  updatedAt: string | null;
  /** Two-factor login is on on this server (TOTP_ENCRYPTION_KEY set); off, nothing is required and the PUT is 503. */
  available: boolean;
}

/**
 * The read path: which enrollable roles must prove a second factor, from a per-replica copy at most
 * REQUIREMENT_CACHE_MS old, else the settings row. Concurrent callers share one read. Any doubt (a failed read, an
 * unreadable value, a missing row) means every enrollable role, and a failed read is not kept.
 */
@Injectable()
export class TwoFactorRequirement {
  private readonly logger = new Logger(TwoFactorRequirement.name);
  private cached: { at: number; roles: ReadonlySet<Role> } | null = null;
  private inFlight: Promise<ReadonlySet<Role>> | null = null;
  /** Bumped by invalidate(): a read that started before a change is neither kept nor shared after it. */
  private generation = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TwoFactorConfig,
  ) {}

  /** May this role enrol (and so get the login's code step once enrolled)? Never while 2FA is off. */
  enrollableFor(role: Role): boolean {
    return this.config.enrollableFor(role);
  }

  /**
   * Must this role prove a second factor on the admin routes? Only an enrollable role is looked up, so no other role
   * ever costs a read; never while 2FA is off.
   */
  async requiredFor(role: Role): Promise<boolean> {
    if (!this.config.enrollableFor(role)) return false;
    return (await this.requiredRoles()).has(role);
  }

  /** Drops this replica's copy, at once after a change through the endpoint. */
  invalidate(): void {
    this.cached = null;
    this.inFlight = null;
    this.generation += 1;
  }

  /** The current row as the admin page shows it, read fresh (not from the copy). */
  async view(): Promise<TwoFactorRequirementView> {
    const row = await this.prisma.setting.findUnique({
      where: { key: REQUIREMENT_KEY },
      select: { value: true, updatedAt: true },
    });
    return {
      roles: (row && parseRequiredRoles(row.value)) ?? [...DEFAULT_REQUIRED_ROLES],
      updatedAt: row?.updatedAt.toISOString() ?? null,
      available: this.config.enabled,
    };
  }

  private requiredRoles(): Promise<ReadonlySet<Role>> {
    const cached = this.cached;
    if (cached && Date.now() - cached.at < REQUIREMENT_CACHE_MS)
      return Promise.resolve(cached.roles);
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const reading = this.read()
      .then((roles) => {
        if (roles && generation === this.generation) this.cached = { at: Date.now(), roles };
        return roles ?? new Set(DEFAULT_REQUIRED_ROLES);
      })
      .finally(() => {
        if (this.inFlight === reading) this.inFlight = null;
      });
    this.inFlight = reading;
    return reading;
  }

  /** The row's roles; the default for a missing or unreadable row; null when the read failed (not kept). */
  private async read(): Promise<ReadonlySet<Role> | null> {
    try {
      const row = await this.prisma.setting.findUnique({
        where: { key: REQUIREMENT_KEY },
        select: { value: true },
      });
      if (!row) return new Set(DEFAULT_REQUIRED_ROLES);
      const roles = parseRequiredRoles(row.value);
      if (roles) return new Set(roles);
      this.logger.error({
        msg: `settings ${REQUIREMENT_KEY} is not an array of enrollable roles: two-factor is required for every enrollable role`,
      });
      return new Set(DEFAULT_REQUIRED_ROLES);
    } catch (e) {
      this.logger.error({
        msg: 'the two-factor requirement could not be read: two-factor is required for every enrollable role',
        ...errorLogFields(e),
      });
      return null;
    }
  }
}
