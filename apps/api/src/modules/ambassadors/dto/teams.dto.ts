import { TEAM_LIMITS as L } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateTeamDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.nameMin, L.nameMax)
  name!: string;
}

/** The code as the student types it: any letter case, surrounding spaces ignored. */
export class JoinTeamDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^TM-[0-9A-Z]{6}$/i)
  code!: string;
}

export class AdminTeamQueryDto {
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
  @Length(1, L.nameMax)
  q?: string;
}

export class RenameTeamDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.nameMin, L.nameMax)
  name!: string;

  @Transform(oneLine)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason!: string;

  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;
}
