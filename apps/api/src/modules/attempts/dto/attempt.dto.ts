import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CLIENT_END_REASONS,
  EXAM_EVENTS_MAX,
  EXAM_EVENT_TYPES,
  EXAM_LIMITS,
  type AnswerList,
  type CheckpointBody,
  type ClientEndReason,
  type ExamEvent,
  type ExamEventType,
  type SubmitBody,
} from '@sirat/shared';

/*
 * The only bodies a student sends during an exam. No time, score, user id or status field exists, and the global
 * ValidationPipe refuses unknown fields, so none can be injected. The answer list's length and values are checked
 * against the attempt's own layout in the service (400 answers_invalid).
 */

/** Seconds since the start; an exam lasts at most 30 minutes, so two hours is generous. */
const EVENT_AT_MAX = 2 * 60 * 60;

export class ExamEventDto implements ExamEvent {
  @IsIn(EXAM_EVENT_TYPES)
  type!: ExamEventType;

  @IsInt()
  @Min(0)
  @Max(EVENT_AT_MAX)
  at!: number;
}

class AnswersAndEvents {
  @IsArray()
  @ArrayMaxSize(EXAM_LIMITS.questionsPerAttemptMax)
  answers!: AnswerList;

  @IsInt()
  @Min(0)
  @Max(EXAM_EVENTS_MAX)
  violationCount!: number;

  @IsArray()
  @ArrayMaxSize(EXAM_EVENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ExamEventDto)
  events!: ExamEventDto[];
}

export class CheckpointDto extends AnswersAndEvents implements CheckpointBody {
  /** Rises with every local change; an older one never overwrites a newer one. */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  seq!: number;
}

export class SubmitDto extends AnswersAndEvents implements SubmitBody {
  /** Client-generated; the same id again returns the same receipt. */
  @IsUUID()
  requestId!: string;

  @IsIn(CLIENT_END_REASONS)
  endReason!: ClientEndReason;
}

export class ResumeQueryDto {
  @IsUUID()
  exam!: string;
}
