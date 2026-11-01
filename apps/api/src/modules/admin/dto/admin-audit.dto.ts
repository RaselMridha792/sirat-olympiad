import { ADMIN_AUDIT_EXPORT, ADMIN_USER_EXPORT, AUDIT_ACTION_PATTERN } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `system`, or something shaped like an email (the server looks the account up). */
const ACTOR = /^(?:system|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

/** The filters of the audit list, shared by the list (query string) and the export (JSON body). */
export class AdminAuditFiltersDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(AUDIT_ACTION_PATTERN)
  action?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 254)
  @Matches(ACTOR)
  actor?: string;

  @IsOptional()
  @IsString()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DAY)
  to?: string;
}

export class AdminAuditQueryDto extends AdminAuditFiltersDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(/^[A-Za-z0-9_-]+$/)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_AUDIT_EXPORT.maxPageSize)
  limit?: number;
}

export class ExportAuditDto extends AdminAuditFiltersDto {
  @Transform(trim)
  @IsString()
  @Length(ADMIN_USER_EXPORT.reasonMin, ADMIN_USER_EXPORT.reasonMax)
  reason!: string;
}
