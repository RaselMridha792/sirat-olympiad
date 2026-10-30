import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword } from '../password-policy';

/**
 * The token from an emailed link. Only its type and length are checked here: a malformed token gets the same
 * answer as an unknown, used or expired one (one message for every failure).
 */
class EmailLinkToken {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}

export class VerifyEmailDto extends EmailLinkToken {}

export class ResetPasswordDto extends EmailLinkToken {
  /** Owner policy: 8-128 characters, not among the 10,000 most common. A refused password leaves the link usable. */
  @IsAcceptablePassword()
  password!: string;
}
