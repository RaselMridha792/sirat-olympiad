import { isParticipantId, normalizeParticipantId } from '@sirat/shared';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/** Trimmed and lower-cased, so limits and lookups see one form of an address (emails are CITEXT anyway). */
export const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** What a person typed, made canonical: upper case, no spaces, dashes or dots ("on 4821-0937 552"). */
const toParticipantId = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeParticipantId(value) : value;

/**
 * A canonical participant ID with a valid Damm check digit. A typo is refused here, before any lookup and without
 * counting a failed login: it says nothing about any account, and an attacker gains nothing (they would send valid
 * check digits anyway). Kids' typos then never lock anyone out (docs/plans/PARTICIPANT-LOGIN-PLAN.md §2).
 */
function IsParticipantId(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isParticipantId',
      target: object.constructor,
      propertyName,
      options: { message: 'Check your participant ID: it is not a valid ID', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isParticipantId(value),
      },
    });
}

/** Exactly one credential: never a password and a participant ID together. */
function NotWith(other: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'notWith',
      target: object.constructor,
      propertyName,
      constraints: [other],
      options: { message: 'Send either a password or a participant ID, not both', ...options },
      validator: {
        validate: (_value: unknown, args: ValidationArguments) =>
          (args.object as Record<string, unknown>)[other] === undefined,
      },
    });
}

/**
 * `{ email, participantId }` for students and ambassadors, `{ email, password }` for staff (owner, 2026-11-10;
 * docs/plans/PARTICIPANT-LOGIN-PLAN.md §2): exactly one of the two. Neither, or both, is a 400.
 */
export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  /** Staff only. Not checked against the password policy here: login only compares. Bounded against abuse. */
  @ValidateIf((o: LoginDto) => o.password !== undefined || o.participantId === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password?: string;

  /** Students and ambassadors: the ID on the admit card, in any spacing or case. */
  @ValidateIf((o: LoginDto) => o.participantId !== undefined || o.password === undefined)
  @Transform(toParticipantId)
  @IsString()
  @MaxLength(32)
  @IsParticipantId()
  @NotWith('password')
  participantId?: string;
}
