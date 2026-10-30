import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from './login.dto';

/** forgot-password and resend-verification: an address only, nothing else (no user id, no role). */
export class EmailOnlyDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;
}
