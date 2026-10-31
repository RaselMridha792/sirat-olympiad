import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType } from '@prisma/client';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import type { EnvVars } from '../../../config/env';
import { emailLink, verifyEmailMessage } from '../../auth/auth-emails';
import { EmailTokenService } from '../../auth/email-tokens.service';
import { EmailQueue } from '../../notifications/email-queue.service';

/**
 * The email a new account gets once its payment is settled (plan 6.3 step 5): A2's verification email, so the
 * student can confirm the address. Verification stays lazy (login does not wait for it). Never throws: the account
 * exists either way, and "resend verification" covers a lost email.
 */
@Injectable()
export class RegistrationEmails {
  private readonly logger = new Logger('RegistrationEmails');
  private readonly appUrl: string;
  private readonly verifyHours: number;

  constructor(
    private readonly tokens: EmailTokenService,
    private readonly emails: EmailQueue,
    config: ConfigService<EnvVars, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }) ?? 'http://localhost:3000';
    this.verifyHours = config.get('EMAIL_VERIFY_TOKEN_HOURS', { infer: true });
  }

  async welcome(user: { id: string; email: string; name: string }): Promise<void> {
    try {
      const issued = await this.tokens.issue(user.id, AuthTokenType.email_verify);
      const link = emailLink(this.appUrl, 'verify-email', issued.token);
      await this.emails.enqueue('verify-email', `verify-email.${issued.id}`, {
        to: user.email,
        ...verifyEmailMessage(user.name, link, this.verifyHours),
      });
    } catch (e) {
      this.logger.error({
        msg: 'registration email not queued',
        userId: user.id,
        ...errorLogFields(e),
      });
    }
  }
}
