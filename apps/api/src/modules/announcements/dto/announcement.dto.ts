import {
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_STATUSES,
  CATEGORIES,
  type AnnouncementStatus,
  type Category,
} from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/** Titles and bodies keep their line breaks; only the ends are trimmed. Shown as plain text, never as HTML. */
const trimEnds = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** Absent: unchanged. Sent: validated, null included (only `category` may be null: everyone). */
const Sent = () => ValidateIf((_object: object, value: unknown) => value !== undefined);

export class PageQueryDto {
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
  @Max(50)
  pageSize?: number;
}

export class AdminAnnouncementQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: AnnouncementStatus;
}

export class CreateAnnouncementDto {
  @Transform(oneLine)
  @IsString()
  @Length(ANNOUNCEMENT_LIMITS.title.min, ANNOUNCEMENT_LIMITS.title.max)
  title!: string;

  @Transform(trimEnds)
  @IsString()
  @Length(ANNOUNCEMENT_LIMITS.body.min, ANNOUNCEMENT_LIMITS.body.max)
  body!: string;

  @ValidateIf((_o: object, v: unknown) => v !== null)
  @IsIn(CATEGORIES)
  category!: Category | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  publishAt?: string;
}

export class UpdateAnnouncementDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @Sent()
  @Transform(oneLine)
  @IsString()
  @Length(ANNOUNCEMENT_LIMITS.title.min, ANNOUNCEMENT_LIMITS.title.max)
  title?: string;

  @Sent()
  @Transform(trimEnds)
  @IsString()
  @Length(ANNOUNCEMENT_LIMITS.body.min, ANNOUNCEMENT_LIMITS.body.max)
  body?: string;

  @IsOptional() // null is a real value here: everyone
  @ValidateIf((_o: object, v: unknown) => v !== null)
  @IsIn(CATEGORIES)
  category?: Category | null;

  @Sent()
  @IsISO8601({ strict: true })
  publishAt?: string;
}

export class AnnouncementStateDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
