import { ADMIN_USER_EXPORT, CATEGORIES, ROLES, type Category, type Role } from '@sirat/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** Query strings carry booleans as text; a JSON body carries real ones. Anything else fails @IsBoolean. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** The filters of the students list, shared by the list (query string) and the export (JSON body). */
export class AdminUserFiltersDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  blocked?: boolean;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  registered?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  verified?: boolean;
}

/** GET /admin/users */
export class AdminUserListQueryDto extends AdminUserFiltersDto {
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
  @Max(100)
  pageSize?: number;
}

/** POST /admin/users/export */
export class ExportUsersDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AdminUserFiltersDto)
  filters!: AdminUserFiltersDto;

  @Transform(trim)
  @IsString()
  @Length(ADMIN_USER_EXPORT.reasonMin, ADMIN_USER_EXPORT.reasonMax)
  reason!: string;
}
