import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Role } from '@sirat/shared';
import type { EnvVars } from '../../../config/env';
import { SecretBox, parseSecretBoxKey } from './secret-box';

/** The roles that must sign in with a second factor (owner default via the lead: admin and manager; jury later). */
export const TWO_FACTOR_ROLES: readonly Role[] = ['admin', 'manager'];

/**
 * Whether two-factor login is on, and the box that seals TOTP secrets. On when TOTP_ENCRYPTION_KEY is set, which
 * production requires (env.ts; compose pins NODE_ENV=production for the api). Without the key, outside production,
 * it is off: not enforced, and the 2FA routes answer 503 (A2, lead).
 */
@Injectable()
export class TwoFactorConfig implements OnModuleInit {
  private readonly logger = new Logger(TwoFactorConfig.name);
  readonly box: SecretBox | null;

  constructor(config: ConfigService<EnvVars, true>) {
    const key = parseSecretBoxKey(config.get('TOTP_ENCRYPTION_KEY', { infer: true }));
    const previous = parseSecretBoxKey(config.get('TOTP_ENCRYPTION_KEY_PREVIOUS', { infer: true }));
    this.box = key ? new SecretBox(key, previous) : null;
  }

  get enabled(): boolean {
    return this.box !== null;
  }

  /** Must this role sign in with a second factor? Never while 2FA is off. */
  requiredFor(role: Role): boolean {
    return this.enabled && TWO_FACTOR_ROLES.includes(role);
  }

  onModuleInit(): void {
    // One boot line operators and prelaunch-check can grep (A2), like `database role=`.
    if (this.enabled) this.logger.log('two-factor=on');
    else this.logger.warn('two-factor=off (TOTP_ENCRYPTION_KEY is not set; development only)');
  }
}
