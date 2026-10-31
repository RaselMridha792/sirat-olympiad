import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ATTEMPT_STATUSES, END_REASONS, type AttemptStatus, type EndReason } from '@sirat/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class PageDto {
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

  /** Name or institution (leaderboards); name or email (admin attempts). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class LeaderboardQueryDto extends PageDto {
  /** Without it: the latest exam whose results are published. */
  @IsOptional()
  @IsUUID()
  exam?: string;
}

export class AdminAttemptsQueryDto extends PageDto {
  @IsOptional()
  @IsIn(ATTEMPT_STATUSES)
  status?: AttemptStatus;

  @IsOptional()
  @IsIn(END_REASONS)
  endReason?: EndReason;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(300)
  minViolations?: number;
}

export class ResultsStateChangeDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
