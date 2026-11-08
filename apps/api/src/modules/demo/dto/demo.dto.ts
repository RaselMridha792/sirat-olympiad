import { DEMO_REASON_LIMITS, type DemoActionInput } from '@sirat/shared';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** POST /admin/demo/load and /admin/demo/clear: the reason goes to the audit log. */
export class DemoActionDto implements DemoActionInput {
  @Transform(trim)
  @IsString()
  @Length(DEMO_REASON_LIMITS.min, DEMO_REASON_LIMITS.max)
  reason!: string;
}
