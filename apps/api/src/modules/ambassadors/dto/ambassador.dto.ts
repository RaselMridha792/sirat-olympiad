import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AMBASSADOR_LIST_SORTS, type AmbassadorListSort } from '@sirat/shared';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class AmbassadorReasonDto {
  @Transform(oneLine)
  @IsString()
  @Length(3, 200)
  reason!: string;
}

export const AMBASSADOR_STATUSES = ['approved', 'revoked'] as const;

/** GET /ambassador/leaderboard. */
export class AmbassadorLeaderboardQueryDto {
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

export class AdminAmbassadorQueryDto {
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
  @Transform(oneLine)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsIn(AMBASSADOR_STATUSES)
  status?: (typeof AMBASSADOR_STATUSES)[number];

  @IsOptional()
  @IsIn(AMBASSADOR_LIST_SORTS)
  sort?: AmbassadorListSort;
}
