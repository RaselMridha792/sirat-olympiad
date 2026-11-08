import {
  CATEGORIES,
  CRITERION_KEY_PATTERN,
  JURY_LIMITS,
  ROUND_LIMITS as L,
  type Category,
} from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** "Sent": a field that is present must be valid; null is not a way to clear it. */
const sent = (_: object, value: unknown) => value !== undefined;

export class RoundCriterionDto {
  @IsString()
  @Matches(CRITERION_KEY_PATTERN)
  key!: string;

  @Transform(oneLine)
  @IsString()
  @Length(1, L.criterionLabelMax)
  en!: string;

  @Transform(oneLine)
  @IsString()
  @Length(1, L.criterionLabelMax)
  bn!: string;
}

/** POST /admin/rounds. The window rules (required for video, both or neither for final) are the service's. */
export class CreateRoundDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.nameMin, L.nameMax)
  name!: string;

  @IsIn(['video', 'final'])
  type!: 'video' | 'final';

  @ValidateIf(sent)
  @IsDateString({ strict: true })
  opensAt?: string;

  @ValidateIf(sent)
  @IsDateString({ strict: true })
  closesAt?: string;

  @ValidateIf(sent)
  @IsArray()
  @ArrayMinSize(L.criteriaMin)
  @ArrayMaxSize(L.criteriaMax)
  @ValidateNested({ each: true })
  @Type(() => RoundCriterionDto)
  criteria?: RoundCriterionDto[];
}

/** PATCH /admin/rounds/:id: the fields sent change. */
export class UpdateRoundDto {
  @ValidateIf(sent)
  @Transform(oneLine)
  @IsString()
  @Length(L.nameMin, L.nameMax)
  name?: string;

  @ValidateIf(sent)
  @IsDateString({ strict: true })
  opensAt?: string;

  @ValidateIf(sent)
  @IsDateString({ strict: true })
  closesAt?: string;

  @ValidateIf(sent)
  @IsArray()
  @ArrayMinSize(L.criteriaMin)
  @ArrayMaxSize(L.criteriaMax)
  @ValidateNested({ each: true })
  @Type(() => RoundCriterionDto)
  criteria?: RoundCriterionDto[];

  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;
}

export class PromotionQueryDto {
  @IsInt()
  @Min(1)
  @Max(L.topNMax)
  topN!: number;

  @IsIn(CATEGORIES)
  category!: Category;
}

export class PromotionExpectedDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  promoted!: number;

  @IsString()
  @Length(1, 200)
  sourceKey!: string;
}

/** POST /admin/rounds/:id/promotion: the preview's `expected` comes back, so a changed source is refused. */
export class PromotionRequestDto extends PromotionQueryDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PromotionExpectedDto)
  expected!: PromotionExpectedDto;
}

/** PUT /rounds/:id/video: the host allow-list is the service's (isAllowedVideoUrl). */
export class VideoSubmitDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, JURY_LIMITS.videoUrlMax)
  url!: string;
}

/** POST /admin/rounds/:id/jury: one judge for one or more categories. */
export class JuryAssignDto {
  @IsUUID()
  judgeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CATEGORIES.length)
  @ArrayUnique()
  @IsIn(CATEGORIES, { each: true })
  categories!: Category[];
}

export class JuryEntryQueryDto {
  @IsUUID()
  round!: string;

  @IsOptional()
  @IsIn(['pending', 'evaluated'])
  status?: 'pending' | 'evaluated';

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

/** POST /jury/entries/:entryId/scores: every criterion of the round, 0–10 (checked by the service). */
export class JuryScoreDto {
  @IsObject()
  criteria!: Record<string, number>;

  /** Trimmed; an empty comment counts as none. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @ValidateIf(sent)
  @IsString()
  @MaxLength(JURY_LIMITS.commentMax)
  comment?: string;
}
