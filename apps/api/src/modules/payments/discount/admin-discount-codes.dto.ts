import { DISCOUNT_KINDS, type DiscountKind } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../registration/registration.controller';

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The largest amount a code may take off, in paisa (the fee is far below it; the 10 BDT floor applies anyway). */
export const MAX_DISCOUNT_AMOUNT_MINOR = 10_000_000;
export const MAX_CODE_USES = 1_000_000;

/** `GET /admin/discount-codes` filters. */
export class AdminDiscountCodesQueryDto extends PageQueryDto {
  /** Part of the code (any case). */
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  q?: string;

  /** active: usable now; inactive: switched off; expired: past its end; scheduled: not started yet. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'expired', 'scheduled'])
  status?: 'active' | 'inactive' | 'expired' | 'scheduled';

  /** Only codes linked to an ambassador. */
  @IsOptional()
  @IsIn(['1'])
  linked?: '1';
}

/**
 * `POST /admin/discount-codes` (an optional field may be null: no limit, no date, no link, no note). Leave `code` out and the server generates one (DC- + 8 characters). `value`: paisa
 * for an amount (whole taka), 1-99 for a percent. Never accepts a demo marker: demo codes come only from the loader.
 */
export class CreateDiscountCodeDto {
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Matches(/^[A-Z0-9-]{4,20}$/, { message: 'A code has 4 to 20 letters, digits or "-"' })
  code?: string;

  @IsIn(DISCOUNT_KINDS)
  kind!: DiscountKind;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DISCOUNT_AMOUNT_MINOR)
  value!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CODE_USES)
  maxUses?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  ambassadorUserId?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  note?: string | null;
}

/**
 * `PATCH /admin/discount-codes/:id`: any of these. Kind, value and the ambassador lock after the first paid use
 * (409 CODE_LOCKED); the code itself never changes (make a new one).
 */
export class UpdateDiscountCodeDto {
  @IsOptional()
  @IsIn(DISCOUNT_KINDS)
  kind?: DiscountKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DISCOUNT_AMOUNT_MINOR)
  value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CODE_USES)
  maxUses?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  ambassadorUserId?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  note?: string | null;
}
