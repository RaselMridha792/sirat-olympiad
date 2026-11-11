import {
  CERT_TEMPLATE_LIMITS,
  CERTIFICATE_TYPES,
  certTextProblem,
  type CertificateIssueOneRequest,
  type CertificateType,
} from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  registerDecorator,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { normalizeEmail } from '../../auth/dto/login.dto';

const L = CERT_TEMPLATE_LIMITS;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A certificate text (shared certTextProblem): only {name}, {round} and {date}, no other brace, no `<` or `>`, at most
 * `max` characters in the worst case after filling. The message is the refusal code `template_text`.
 */
function IsCertText(max: number, placeholders = true, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isCertText',
      target: object.constructor,
      propertyName,
      options: { message: `template_text: ${propertyName}`, ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && certTextProblem(value, max, placeholders) === null,
      },
    });
}

export class CertificateSignatoryDto {
  @Transform(trim)
  @IsString()
  @IsCertText(L.signatoryTextMax, false)
  nameEn!: string;

  @Transform(trim)
  @IsString()
  @IsCertText(L.signatoryTextMax, false)
  nameBn!: string;

  @Transform(trim)
  @IsString()
  @IsCertText(L.signatoryTextMax, false)
  titleEn!: string;

  @Transform(trim)
  @IsString()
  @IsCertText(L.signatoryTextMax, false)
  titleBn!: string;

  @IsOptional()
  @IsUUID()
  imageId?: string | null;
}

/** POST /admin/certificate-templates/:id/versions: an edit (the type stays the template's). */
export class CertificateTemplateVersionDto {
  @Transform(trim)
  @IsString()
  @IsCertText(L.titleMax)
  titleEn!: string;

  @Transform(trim)
  @IsString()
  @IsCertText(L.titleMax)
  titleBn!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(L.bodyMax)
  @IsCertText(L.bodyMax)
  bodyEn!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(L.bodyMax)
  @IsCertText(L.bodyMax)
  bodyBn!: string;

  @IsArray()
  @ArrayMaxSize(L.signatoriesMax)
  @ValidateNested({ each: true })
  @Type(() => CertificateSignatoryDto)
  signatories!: CertificateSignatoryDto[];
}

/** POST /admin/certificate-templates: a new template, version 1. */
export class CertificateTemplateDto extends CertificateTemplateVersionDto {
  @IsIn(CERTIFICATE_TYPES)
  type!: CertificateType;
}

/** POST /admin/certificates/issue-one. */
export class CertificateIssueOneDto implements CertificateIssueOneRequest {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(CERTIFICATE_TYPES)
  type!: CertificateType;

  @IsUUID()
  roundId!: string;

  @Transform(trim)
  @IsString()
  @Length(L.reasonMin, L.reasonMax)
  reason!: string;
}
