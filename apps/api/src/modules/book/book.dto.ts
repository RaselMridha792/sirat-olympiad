import { BD_DISTRICTS, BOOK_ORDER_LIMITS, BOOK_ORDER_STATUSES } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeEmail } from '../auth/dto/login.dto';
import { toBdMobile } from '../payments/registration/dto/start-registration.dto';

const squash = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** An empty optional field is no field. */
const blankToUndefined = ({ value }: { value: unknown }): unknown => {
  const v = squash({ value });
  return v === '' ? undefined : v;
};
const L = BOOK_ORDER_LIMITS;

/**
 * PUT /book-order/me (plan 16.3; owner B1, B2). Never an id, a user, a status or a title: unknown fields are refused
 * by the global ValidationPipe (whitelist + forbidNonWhitelisted). Messages name the rule, never the value.
 */
export class BookOrderDto {
  @Transform(squash)
  @IsString()
  @Length(1, L.recipientNameMax)
  recipientName!: string;

  @Transform(toBdMobile)
  @IsString()
  @Matches(/^01[3-9][0-9]{8}$/, { message: 'Enter a Bangladeshi mobile number, e.g. 01712345678' })
  recipientPhone!: string;

  @IsIn(BD_DISTRICTS)
  district!: string;

  @Transform(squash)
  @IsString()
  @Length(L.upazilaMin, L.upazilaMax)
  upazila!: string;

  @Transform(squash)
  @IsString()
  @Length(L.addressLineMin, L.addressLineMax)
  addressLine!: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(L.noteMax)
  note?: string;

  /** The version the form showed (leave out on the first save). */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

/** PUT /admin/book/title (plan 3.4 pattern: `expected` is the title the admin's form showed). */
export class BookTitleDto {
  @Transform(squash)
  @IsString()
  @Length(1, L.titleMax)
  title!: string;

  @IsString()
  @MaxLength(L.titleMax)
  expected!: string;

  @Transform(squash)
  @IsString()
  @Length(3, 200)
  reason!: string;
}

/** Filters of the admin list and the courier export. */
export class BookOrderFilterDto {
  @IsOptional()
  @IsIn(BOOK_ORDER_STATUSES)
  status?: (typeof BOOK_ORDER_STATUSES)[number];

  @IsOptional()
  @IsIn(BD_DISTRICTS)
  district?: string;
}

export class AdminBookOrdersQueryDto extends BookOrderFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Transform(toBdMobile)
  @Matches(/^01[3-9][0-9]{8}$/)
  phone?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  email?: string;
}

/** POST /admin/book-orders/ship */
export class ShipBookOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(3, 200)
  reason?: string;
}
