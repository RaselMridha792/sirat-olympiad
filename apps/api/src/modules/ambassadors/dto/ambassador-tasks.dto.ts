import { TASK_LIMITS as L, TASK_LIST_STATUSES } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Keeps line breaks (a description or a proof may have several lines); trims the ends. */
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value;
/** Present means present: `null` is refused, not taken as "not sent" (as for the profile, C3). */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

export class CreateTaskDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.titleMin, L.titleMax)
  title!: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, L.descriptionMax)
  description!: string;

  @IsInt()
  @Min(0)
  @Max(L.pointsMax)
  points!: number;
}

export class PatchTaskDto {
  @Sent()
  @Transform(oneLine)
  @IsString()
  @Length(L.titleMin, L.titleMax)
  title?: string;

  @Sent()
  @Transform(trimmed)
  @IsString()
  @Length(1, L.descriptionMax)
  description?: string;

  @Sent()
  @IsInt()
  @Min(0)
  @Max(L.pointsMax)
  points?: number;

  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;
}

export class AdminTaskQueryDto {
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

  @IsOptional()
  @IsIn(TASK_LIST_STATUSES)
  status?: (typeof TASK_LIST_STATUSES)[number];
}

export class ReviewQueueQueryDto {
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

export class AssignTaskDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.assignMax)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class RejectTaskDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.noteMin, L.noteMax)
  note!: string;
}

export class SubmitProofDto {
  @Transform(trimmed)
  @IsString()
  @Length(1, L.proofMax)
  proof!: string;
}
