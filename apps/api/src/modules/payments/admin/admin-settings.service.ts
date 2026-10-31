import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { validFee } from '../registration/registration-settings';
import { RegistrationService } from '../registration/registration.service';
import type { Actor } from './admin-payments.service';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
const isoOrNull = (v: unknown): Prisma.InputJsonValue | null | undefined => {
  if (v === null) return null;
  if (typeof v !== 'string' || !ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) return undefined;
  return new Date(v).toISOString();
};

/**
 * The settings an admin may change (plan 3.4), each with its own rule; anything else is not editable here. Returns
 * the value to store, or undefined when the value is not acceptable. The fee: 10–10,000 BDT in whole taka, in paisa
 * (the bounds catch an extra zero; the DB CHECK refuses a non-positive or fractional fee as well).
 */
const EDITABLE: Record<string, (v: unknown) => Prisma.InputJsonValue | null | undefined> = {
  registration_fee_minor: (v) => validFee(v) ?? undefined,
  registration_open: (v) => (typeof v === 'boolean' ? v : undefined),
  registration_opens_at: isoOrNull,
  registration_closes_at: isoOrNull,
  payment_expiry_minutes: (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 1_440 ? v : undefined,
};
/** A reason is required for the fee (3–200 characters; the DTO checks the length). */
const NEEDS_REASON = new Set(['registration_fee_minor']);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type SettingView = { key: string; value: Prisma.JsonValue; updatedAt: string };

/**
 * Admin settings (plan 3.4; Role admin only, not manager). One writer at a time: the row is locked and the value the
 * admin's form showed (`expected`) must still be the current one, so an old form never overwrites someone else's
 * change (409). The audit row is written in the same transaction; the registration info cache is cleared after it.
 * Payments already started keep their fee snapshot.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: RegistrationService,
  ) {}

  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: Object.keys(EDITABLE) } },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() }));
  }

  async update(
    actor: Actor,
    key: string,
    body: { value?: unknown; expected?: unknown; reason?: string },
  ): Promise<SettingView> {
    const rule = Object.hasOwn(EDITABLE, key) ? EDITABLE[key] : undefined;
    if (!rule) throw new NotFoundException('This setting cannot be changed here');
    if (body.value === undefined || body.expected === undefined)
      throw new BadRequestException('value and expected are required');
    const next = rule(body.value);
    if (next === undefined)
      throw new BadRequestException({ code: 'SETTING_INVALID', message: `Not a valid ${key}` });
    if (NEEDS_REASON.has(key) && !body.reason)
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required for this change',
      });

    const saved = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ value: Prisma.JsonValue }[]>`
        SELECT value FROM settings WHERE key = ${key} FOR UPDATE`;
      if (!current) throw new NotFoundException('Setting not found');
      if (!same(current.value, body.expected))
        throw new ConflictException({
          code: 'SETTING_CHANGED',
          message: 'This setting was changed by someone else. Reload and check.',
        });
      await assertWindow(tx, key, next);
      const row = await tx.setting.update({
        where: { key },
        data: { value: next === null ? Prisma.JsonNull : next },
      });
      await tx.auditLog.create({
        data: {
          action: 'settings.changed',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'setting',
          entityId: key,
          meta: {
            key,
            old: current.value ?? null,
            new: next,
            ...(body.reason ? { reason: body.reason } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    await this.registrations.invalidateInfo();
    return { key: saved.key, value: saved.value, updatedAt: saved.updatedAt.toISOString() };
  }
}

/** Registration opens before it closes, when both are set. */
async function assertWindow(
  tx: Prisma.TransactionClient,
  key: string,
  next: Prisma.InputJsonValue | null,
): Promise<void> {
  if (key !== 'registration_opens_at' && key !== 'registration_closes_at') return;
  const otherKey =
    key === 'registration_opens_at' ? 'registration_closes_at' : 'registration_opens_at';
  const other = (await tx.setting.findUnique({ where: { key: otherKey } }))?.value;
  if (typeof next !== 'string' || typeof other !== 'string') return;
  const [opens, closes] = key === 'registration_opens_at' ? [next, other] : [other, next];
  if (Date.parse(opens) >= Date.parse(closes))
    throw new BadRequestException({
      code: 'SETTING_INVALID',
      message: 'Registration must open before it closes',
    });
}
