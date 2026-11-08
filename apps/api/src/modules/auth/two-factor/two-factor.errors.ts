import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/*
 * The answers of two-factor login, each with a machine code the web maps to a bn/en text (the `{ code, message }`
 * body the exception filter passes on). Messages never say whether an account, a code or a challenge exists beyond
 * what the caller already proved.
 */

/** An admin or manager route, and this session has not proved a second factor (the guard). */
export const twoFactorRequired = () =>
  new ForbiddenException({
    code: 'TWO_FACTOR_REQUIRED',
    message: 'Two-factor login is required for this account',
  });

/** 2FA is off on this server (no TOTP_ENCRYPTION_KEY, development only): every 2FA route. */
export const twoFactorUnavailable = () =>
  new ServiceUnavailableException({
    code: 'TWO_FACTOR_UNAVAILABLE',
    message: 'Two-factor login is not available on this server',
  });

/** The login's code step: no challenge cookie, or it expired, was used, or was used up. Log in again. */
export const challengeInvalid = () =>
  new UnauthorizedException({
    code: 'TWO_FACTOR_CHALLENGE_INVALID',
    message: 'The sign-in step has expired. Log in again',
  });

/** The login's code step: a wrong, used or malformed code (TOTP or recovery). */
export const loginCodeInvalid = () =>
  new UnauthorizedException({
    code: 'TWO_FACTOR_CODE_INVALID',
    message: 'The code is incorrect',
  });

/** A signed-in step-up with a wrong or already used code: 400, so the web never mistakes it for a lost session. */
export const codeInvalid = () =>
  new BadRequestException({ code: 'TWO_FACTOR_CODE_INVALID', message: 'The code is incorrect' });

/** A signed-in step-up with a wrong password (like change-password, 400). */
export const passwordIncorrect = () =>
  new BadRequestException({ code: 'PASSWORD_INCORRECT', message: 'The password is incorrect' });

export const alreadyEnabled = () =>
  new ConflictException({
    code: 'TWO_FACTOR_ALREADY_ENABLED',
    message: 'Two-factor login is already on',
  });

export const notEnabled = () =>
  new ConflictException({
    code: 'TWO_FACTOR_NOT_ENABLED',
    message: 'Two-factor login is not on for this account',
  });

/** enable without a pending setup, or the setup was replaced meanwhile. */
export const setupRequired = () =>
  new ConflictException({
    code: 'TWO_FACTOR_SETUP_REQUIRED',
    message: 'Start the setup again',
  });

export const resetNotAllowed = (message: string) =>
  new ForbiddenException({ code: 'TWO_FACTOR_RESET_NOT_ALLOWED', message });

/**
 * PUT /admin/security/two-factor-requirement: the set the admin's form showed (`expected`) is no longer the current
 * one (someone else changed it meanwhile). Reload and check.
 */
export const requirementChanged = () =>
  new ConflictException({
    code: 'TWO_FACTOR_REQUIREMENT_CHANGED',
    message: 'The two-factor requirement was changed by someone else. Reload and check',
  });
