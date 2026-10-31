import { BD_DISTRICTS, EDUCATION_TYPES, normalizeBdMobile, PROFILE_LIMITS } from '@sirat/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** 01XXXXXXXXX, or the raw input when it is not a Bangladeshi mobile number (the pattern then refuses it). */
/**
 * A field that is absent is not changed; one that is sent must be valid. Unlike @IsOptional(), null is validated
 * too (and refused): no profile field can be cleared, and a null phone must never reach the phone checks.
 */
const Sent = () => ValidateIf((_object: object, value: unknown) => value !== undefined);

const toBdMobile = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? (normalizeBdMobile(value) ?? value) : value;

/**
 * PATCH /users/me (core plan Q1). The same rules as the registration form (payments' StartRegistrationDto; a unit
 * test feeds both the same samples). Every field optional, none can be cleared; email, grade, role, category and
 * anything else are refused by the global ValidationPipe (whitelist + forbidNonWhitelisted).
 */
export class UpdateProfileDto {
  @Sent()
  @Transform(trim)
  @IsString()
  @Length(PROFILE_LIMITS.name.min, PROFILE_LIMITS.name.max)
  name?: string;

  @Sent()
  @Transform(toBdMobile)
  @IsString()
  @Matches(/^01[3-9][0-9]{8}$/, { message: 'Enter a Bangladeshi mobile number, e.g. 01712345678' })
  phone?: string;

  @Sent()
  @IsIn(BD_DISTRICTS)
  district?: string;

  @Sent()
  @Transform(trim)
  @IsString()
  @Length(PROFILE_LIMITS.institution.min, PROFILE_LIMITS.institution.max)
  institution?: string;

  @Sent()
  @IsIn(EDUCATION_TYPES)
  educationType?: string;
}

/** POST /admin/users/:id/grade-level */
export class CorrectGradeDto {
  @IsUUID()
  gradeLevelId!: string;

  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason!: string;
}
