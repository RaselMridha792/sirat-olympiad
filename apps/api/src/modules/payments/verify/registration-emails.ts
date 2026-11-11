import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType } from '@prisma/client';
import { formatParticipantId } from '@sirat/shared';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import { escapeHtml } from '../../../common/html';
import type { EnvVars } from '../../../config/env';
import { emailLink, verifyEmailMessage } from '../../auth/auth-emails';
import { EmailTokenService } from '../../auth/email-tokens.service';
import { EmailQueue } from '../../notifications/email-queue.service';

export interface RegistrationEmail {
  subject: string;
  text: string;
  html: string;
}

type IdMessageParts = {
  greeting: string;
  done: string;
  idLabel: string;
  use: string;
  private: string;
};

/** Bangla first, then English, like the auth emails; the ID stands out in the HTML, and user text is escaped. */
function renderIdMessage(
  subject: string,
  bn: IdMessageParts,
  en: IdMessageParts,
  id: string,
  loginLink: string,
): RegistrationEmail {
  const button = 'লগইন / Sign in';
  const text = [
    bn.greeting,
    '',
    bn.done,
    `${bn.idLabel} ${id}`,
    bn.use,
    loginLink,
    '',
    bn.private,
    '',
    '---',
    '',
    en.greeting,
    '',
    en.done,
    `${en.idLabel} ${id}`,
    en.use,
    loginLink,
    '',
    en.private,
  ].join('\n');
  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const idLine = (label: string) =>
    `<p>${escapeHtml(label)} <strong style="font-size:1.2em;letter-spacing:.05em">${escapeHtml(id)}</strong></p>`;
  const link = escapeHtml(loginLink);
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">',
    p(bn.greeting),
    p(bn.done),
    idLine(bn.idLabel),
    p(bn.use),
    `<p><a href="${link}">${escapeHtml(button)}</a></p>`,
    p(bn.private),
    '<hr>',
    p(en.greeting),
    p(en.done),
    idLine(en.idLabel),
    p(en.use),
    `<p><a href="${link}">${link}</a></p>`,
    p(en.private),
    '</body></html>',
  ].join('\n');
  return { subject, text, html };
}

/**
 * "Registration complete, your participant ID" (DECISIONS "The participant ID"). Bilingual like the auth emails. It
 * carries a credential on the owner's choice: with the email, the ID is the student's login, so the message says to
 * keep it private. The ID is never logged; this only builds the message.
 */
export function registrationConfirmedMessage(
  name: string,
  participantId: string,
  loginLink: string,
): RegistrationEmail {
  const id = formatParticipantId(participantId);
  const bn = {
    greeting: `প্রিয় ${name},`,
    done: 'Sirat Leadership Olympiad-এ আপনার রেজিস্ট্রেশন সম্পন্ন হয়েছে।',
    idLabel: 'আপনার পার্টিসিপেন্ট আইডি:',
    use: 'এই আইডি আপনার প্রবেশপত্রে থাকবে। লগইন করতে আপনার ইমেইলের সঙ্গে এই আইডি লাগবে।',
    private:
      'আইডিটি গোপন রাখুন: কাউকে বলবেন না, আর প্রবেশপত্রের ছবি কোথাও পোস্ট করবেন না। আইডি কেউ জেনে গেলে আয়োজকদের জানান।',
  };
  const en = {
    greeting: `Dear ${name},`,
    done: 'Your registration for the Sirat Leadership Olympiad is complete.',
    idLabel: 'Your participant ID:',
    use: 'It is printed on your admit card, and you sign in with it together with your email.',
    private:
      'Keep it private: do not tell anyone, and do not post a photo of your admit card. If someone learns it, tell the organisers.',
  };
  return renderIdMessage(
    'Sirat Leadership Olympiad: রেজিস্ট্রেশন সম্পন্ন / Registration complete',
    bn,
    en,
    id,
    loginLink,
  );
}

/** "Your participant ID was changed" (P1b): the new ID; the old one no longer works. */
export function participantIdReissuedMessage(
  name: string,
  participantId: string,
  loginLink: string,
): RegistrationEmail {
  const id = formatParticipantId(participantId);
  const bn = {
    greeting: `প্রিয় ${name},`,
    done: 'আয়োজকেরা আপনার পার্টিসিপেন্ট আইডি বদলে দিয়েছেন। আগের আইডি আর কাজ করবে না, আর সব ডিভাইস থেকে আপনাকে লগআউট করা হয়েছে।',
    idLabel: 'আপনার নতুন পার্টিসিপেন্ট আইডি:',
    use: 'লগইন করতে আপনার ইমেইলের সঙ্গে নতুন আইডি দিন। প্রবেশপত্রটি নতুন করে ডাউনলোড করুন।',
    private: 'আইডিটি গোপন রাখুন। আপনি এটা না চেয়ে থাকলে আয়োজকদের জানান।',
  };
  const en = {
    greeting: `Dear ${name},`,
    done: 'The organisers have changed your participant ID. The old ID no longer works, and you have been signed out everywhere.',
    idLabel: 'Your new participant ID:',
    use: 'Sign in with your email and the new ID, and download your admit card again.',
    private: 'Keep it private. If you did not ask for this, tell the organisers.',
  };
  return renderIdMessage(
    'Sirat Leadership Olympiad: নতুন পার্টিসিপেন্ট আইডি / Your new participant ID',
    bn,
    en,
    id,
    loginLink,
  );
}

/**
 * The emails a new account gets once its payment is settled (plan 6.3 step 5):
 * - the registration confirmation with the participant ID (key `registration-confirmed.<registrationId>`, never the
 *   same as A2's `participant-id.<uuid>` forgot-ID email, which covers a lost one);
 * - A2's verification email, so the student can confirm the address. Verification stays lazy (login does not wait for
 *   it); "resend verification" covers a lost one.
 * Never throws: the account exists either way.
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

  async welcome(user: {
    id: string;
    email: string;
    name: string;
    registrationId: string;
    participantId: string;
  }): Promise<void> {
    try {
      await this.emails.enqueue(
        'registration-confirmed',
        `registration-confirmed.${user.registrationId}`,
        {
          to: user.email,
          ...registrationConfirmedMessage(user.name, user.participantId, `${this.appUrl}/login`),
        },
      );
    } catch (e) {
      this.logger.error({
        msg: 'registration confirmation not queued',
        userId: user.id,
        ...errorLogFields(e),
      });
    }
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

  /** P1b: the new ID after an admin replaced it; key per audit row, so a repeat never sends twice. True when queued. */
  async participantIdReissued(
    user: { id: string; email: string; name: string },
    participantId: string,
    auditId: string,
  ): Promise<boolean> {
    try {
      return await this.emails.enqueue(
        'participant-id-reissued',
        `participant-id-reissued.${auditId}`,
        {
          to: user.email,
          ...participantIdReissuedMessage(user.name, participantId, `${this.appUrl}/login`),
        },
      );
    } catch (e) {
      this.logger.error({
        msg: 'participant ID email not queued',
        userId: user.id,
        ...errorLogFields(e),
      });
      return false;
    }
  }
}
