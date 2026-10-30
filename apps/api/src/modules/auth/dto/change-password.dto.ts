import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword } from '../password-policy';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  /** Owner policy: 8-128 characters, not among the 10,000 most common. */
  @IsAcceptablePassword()
  newPassword!: string;
}
