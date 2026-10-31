import { PaymentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { normalizeEmail } from '../../auth/dto/login.dto';
import { toBdMobile } from '../registration/dto/start-registration.dto';
import { PageQueryDto } from '../registration/registration.controller';

/** `GET /admin/payments` filters (plan 6.7). All exact matches on indexed or unique columns. */
export class AdminPaymentsQueryDto extends PageQueryDto {
  @IsOptional()
  @Matches(/^[A-Z0-9]{10,20}$/)
  invoice?: string;

  @IsOptional()
  @IsString()
  @Length(4, 100)
  trx?: string;

  @IsOptional()
  @Transform(toBdMobile)
  @Matches(/^01[3-9][0-9]{8}$/)
  phone?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** `1`: only payments set aside for an admin (review_reason set). */
  @IsOptional()
  @IsIn(['1'])
  review?: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]{3,32}$/)
  account?: string;
}

/**
 * `POST /admin/payments/:id/reconcile` (lead, 2026-10-31): the trx_id copied from PayStation's merchant panel and
 * why. Only for a success PayStation reported without a trx_id (see AdminPaymentsService.reconcile).
 */
export class ReconcilePaymentDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{6,64}$/, { message: 'Enter the trx_id exactly as PayStation shows it' })
  trxId!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 200)
  reason!: string;
}
