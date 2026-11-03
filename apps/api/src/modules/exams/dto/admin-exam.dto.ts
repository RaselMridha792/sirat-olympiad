import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CATEGORIES,
  EXAM_LIMITS,
  EXAM_MAX_DURATION_MINUTES,
  EXAM_STATUSES,
  type AdminExamInput,
  type AdminExamPatch,
  type AdminQuestionInput,
  type Category,
  type ExamStatus,
  type QuestionOption,
} from '@sirat/shared';
import { NoControlCharacters } from '../../../common/no-control-characters';

/*
 * Exam admin bodies (06-API "Exam admin"). The global ValidationPipe rejects unknown fields, so nothing outside
 * these lists (status, contentVersion, publishedAt, resultsPublishedAt, ids) can be set by a request.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** ISO 8601 with an explicit zone: a bare local time would mean a different moment on every machine. */
const ISO_WITH_ZONE = /T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const zoned = { message: '$property must be an ISO 8601 time with a zone (Z or +06:00)' };

const OPTION_KEY = /^[A-Z]$/;

export class CreateExamDto implements AdminExamInput {
  @Transform(trim)
  @IsString()
  @Length(1, EXAM_LIMITS.titleMax)
  title!: string;

  /** null = every category. */
  @IsOptional()
  @IsIn(CATEGORIES)
  category!: Category | null;

  @IsOptional()
  @IsUUID()
  roundId!: string | null;

  @IsISO8601({ strict: true })
  @Matches(ISO_WITH_ZONE, zoned)
  windowStart!: string;

  @IsISO8601({ strict: true })
  @Matches(ISO_WITH_ZONE, zoned)
  windowEnd!: string;

  @IsInt()
  @Min(1)
  @Max(EXAM_MAX_DURATION_MINUTES)
  durationMinutes!: number;

  @IsInt()
  @Min(1)
  @Max(EXAM_LIMITS.questionsPerAttemptMax)
  questionsPerAttempt!: number;

  @IsInt()
  @Min(0)
  @Max(EXAM_LIMITS.graceSecondsMax)
  graceSeconds!: number;

  /** false (owner, Q2): everyone gets the same questions. */
  @IsBoolean()
  randomDraw!: boolean;
}

/** Every field optional; `expectedUpdatedAt` is the value the admin's screen showed (409 if it changed since). */
export class UpdateExamDto implements AdminExamPatch {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, EXAM_LIMITS.titleMax)
  title?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category | null;

  @IsOptional()
  @IsUUID()
  roundId?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(ISO_WITH_ZONE, zoned)
  windowStart?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(ISO_WITH_ZONE, zoned)
  windowEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXAM_MAX_DURATION_MINUTES)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXAM_LIMITS.questionsPerAttemptMax)
  questionsPerAttempt?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(EXAM_LIMITS.graceSecondsMax)
  graceSeconds?: number;

  @IsOptional()
  @IsBoolean()
  randomDraw?: boolean;

  /** Required when a published exam's window is extended (audited). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(EXAM_LIMITS.reasonMin, EXAM_LIMITS.reasonMax)
  reason?: string;
}

/** publish, unpublish, archive. */
export class ExamStateChangeDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class QuestionOptionDto implements QuestionOption {
  @Matches(OPTION_KEY, { message: 'key must be one capital letter A-Z' })
  key!: string;

  @Transform(trim)
  @IsString()
  @Length(1, EXAM_LIMITS.optionTextMax)
  @NoControlCharacters()
  text!: string;
}

export class QuestionDto implements AdminQuestionInput {
  @Transform(trim)
  @IsString()
  @Length(1, EXAM_LIMITS.questionTextMax)
  @NoControlCharacters()
  text!: string;

  @IsArray()
  @ArrayMinSize(EXAM_LIMITS.optionsMin)
  @ArrayMaxSize(EXAM_LIMITS.optionsMax)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];

  @Matches(OPTION_KEY, { message: 'correctKey must be one capital letter A-Z' })
  correctKey!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(EXAM_LIMITS.explanationMax)
  @NoControlCharacters()
  explanation!: string | null;

  @IsOptional()
  @IsBoolean()
  keepOptionOrder!: boolean;
}

/** PUT: the question as the admin's screen showed it (409 if it changed or was replaced since). */
export class UpdateQuestionDto extends QuestionDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

/** POST /admin/exams/:id/questions/import. Required: a request without it never imports by accident. */
export class QuestionImportQueryDto {
  @IsIn(['true', 'false'])
  dryRun!: 'true' | 'false';
}

export class ExamListQueryDto {
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
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: ExamStatus;
}
