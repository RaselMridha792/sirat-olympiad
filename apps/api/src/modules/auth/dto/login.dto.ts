import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Trimmed and lower-cased, so limits and lookups see one form of an address (emails are CITEXT anyway). */
export const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  /** Not checked against the password policy here: login only compares. Bounded so it cannot be abused. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
