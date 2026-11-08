import { Transform } from 'class-transformer';
import type { Role } from '@sirat/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';
import { TWO_FACTOR_ROLES } from '../two-factor/two-factor.config';

/** A TOTP code: exactly 6 digits (what every authenticator app shows). */
const TOTP_CODE = /^\d{6}$/;
const TOTP_MESSAGE = 'Enter the 6-digit code from your authenticator app';
/**
 * A recovery code as people type it: 10 base32 characters, any case, with spaces or dashes (XXXXX-XXXXX). The service
 * normalises it; anything else is refused here.
 */
const RECOVERY_CODE = /^[A-Za-z2-7\s-]{10,20}$/;
const RECOVERY_MESSAGE = 'Enter a recovery code (XXXXX-XXXXX)';

/** Valid only when the other property is absent: with the ValidateIf below, "exactly one of the two". */
function AbsentWith(other: string, message: string) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'absentWith',
      target: target.constructor,
      propertyName,
      constraints: [other],
      options: { message },
      validator: {
        validate: (_value: unknown, args: ValidationArguments) =>
          (args.object as Record<string, unknown>)[args.constraints[0] as string] === undefined,
      },
    });
}

const ONE_FACTOR = 'Send either code or recoveryCode, not both';

/**
 * Exactly one second factor: `code` (TOTP) or `recoveryCode`. Neither: `code` is checked and fails. Both:
 * `recoveryCode` fails.
 */
export class SecondFactorDto {
  @ValidateIf((o: SecondFactorDto) => o.code !== undefined || o.recoveryCode === undefined)
  @Matches(TOTP_CODE, { message: TOTP_MESSAGE })
  code?: string;

  @ValidateIf((o: SecondFactorDto) => o.recoveryCode !== undefined)
  @IsString()
  @Matches(RECOVERY_CODE, { message: RECOVERY_MESSAGE })
  @AbsentWith('code', ONE_FACTOR)
  recoveryCode?: string;
}

/** POST /auth/2fa/verify: the login's code step. */
export class TwoFactorVerifyDto extends SecondFactorDto {}

/** POST /auth/2fa/setup: the password again (a stolen session alone cannot enrol). */
export class TwoFactorSetupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

/** POST /auth/2fa/enable and POST /auth/2fa/recovery-codes: a current TOTP code (no recovery code). */
export class TwoFactorCodeDto {
  @Matches(TOTP_CODE, { message: TOTP_MESSAGE })
  code!: string;
}

/** POST /auth/2fa/disable: both factors, the password and a code (TOTP or recovery). */
export class TwoFactorDisableDto extends SecondFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** POST /admin/users/:id/2fa/reset: why (audited), and the ACTING admin's current TOTP code (step-up). */
export class TwoFactorResetDto {
  @Transform(oneLine)
  @IsString()
  @Length(3, 200)
  reason!: string;

  @Matches(TOTP_CODE, { message: TOTP_MESSAGE })
  code!: string;
}

const ROLE_MESSAGE = `Each role must be one of: ${TWO_FACTOR_ROLES.join(', ')}`;

/**
 * PUT /admin/security/two-factor-requirement: the roles that must prove a second factor (none, admin, manager, or
 * both), the set the form showed (`expected`, 409 when someone changed it meanwhile), why (audited), and the ACTING
 * admin's current TOTP code (step-up). An unknown role is a 400.
 */
export class TwoFactorRequirementDto {
  @IsArray()
  @ArrayMaxSize(TWO_FACTOR_ROLES.length)
  @ArrayUnique()
  @IsIn(TWO_FACTOR_ROLES, { each: true, message: ROLE_MESSAGE })
  roles!: Role[];

  @IsArray()
  @ArrayMaxSize(TWO_FACTOR_ROLES.length)
  @ArrayUnique()
  @IsIn(TWO_FACTOR_ROLES, { each: true, message: ROLE_MESSAGE })
  expected!: Role[];

  @Transform(oneLine)
  @IsString()
  @Length(3, 200)
  reason!: string;

  @Matches(TOTP_CODE, { message: TOTP_MESSAGE })
  code!: string;
}
