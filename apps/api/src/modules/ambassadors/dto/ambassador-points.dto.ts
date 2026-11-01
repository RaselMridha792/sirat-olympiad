import { AMBASSADOR_POINTS_LIMITS as L } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class RankThresholdDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.nameMin, L.nameMax)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(L.maxMinPoints)
  minPoints!: number;
}

export class AmbassadorPointsConfigDto {
  @IsInt()
  @Min(0)
  @Max(L.maxPerReferral)
  pointsPerReferral!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.maxThresholds)
  @ValidateNested({ each: true })
  @Type(() => RankThresholdDto)
  thresholds!: RankThresholdDto[];
}

/** PUT /admin/ambassador-points. The order rules (first at 0, rising, unique names) are checked by the service. */
export class UpdateAmbassadorPointsDto extends AmbassadorPointsConfigDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AmbassadorPointsConfigDto)
  expected!: AmbassadorPointsConfigDto;

  @Transform(oneLine)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason!: string;
}

/** POST /admin/points/adjust: a compensating entry, positive or negative. */
export class AdjustPointsDto {
  @IsUUID()
  userId!: string;

  @IsInt()
  @Min(-L.maxAdjust)
  @Max(L.maxAdjust)
  @NotEquals(0)
  amount!: number;

  @Transform(oneLine)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason!: string;
}
