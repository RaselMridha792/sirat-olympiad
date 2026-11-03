import { CERTIFICATE_LIMITS as L, CERTIFICATE_TYPES, type CertificateType } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** "Sent": a field that is present must be valid. */
const sent = (_: object, value: unknown) => value !== undefined;

/** POST /admin/certificates/issue: `emails` and `reason` for winners (the service checks which type needs what). */
export class IssueCertificatesDto {
  @IsIn(CERTIFICATE_TYPES)
  type!: CertificateType;

  @IsUUID()
  roundId!: string;

  @ValidateIf(sent)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.winnersMax)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  emails?: string[];

  @ValidateIf(sent)
  @Transform(oneLine)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason?: string;
}

export class AdminCertificateQueryDto {
  @IsOptional()
  @Transform(oneLine)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsIn(CERTIFICATE_TYPES)
  type?: CertificateType;

  @IsOptional()
  @IsUUID()
  round?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

export class RevokeCertificateDto {
  @Transform(oneLine)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason!: string;

  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;
}
