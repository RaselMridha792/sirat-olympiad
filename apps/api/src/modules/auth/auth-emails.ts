/**
 * Auth emails: one bilingual message each, Bangla first, then English (no per-user language is stored yet). All
 * copy lives here. User-supplied values are HTML-escaped; no email ever contains a password (RULEBOOK §18).
 * Links carry the token after `#`, so it never reaches a server, a log or a Referer header, and the web page
 * POSTs it on a button press (mail scanners that open links cannot use it up).
 */

import { escapeHtml } from '../../common/html';

export interface AuthEmail {
  subject: string;
  text: string;
  html: string;
}

export { escapeHtml };

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
const bn = (n: number): string => String(n).replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d);

/** `${origin}/verify-email#token=...` and `${origin}/reset-password#token=...`. */
export const emailLink = (origin: string, page: 'verify-email' | 'reset-password', token: string) =>
  `${origin}/${page}#token=${token}`;

function render(parts: {
  subject: string;
  greetingBn: string;
  bodyBn: string;
  ignoreBn: string;
  greetingEn: string;
  bodyEn: string;
  ignoreEn: string;
  button: string;
  link: string;
}): AuthEmail {
  const text = [
    parts.greetingBn,
    '',
    parts.bodyBn,
    parts.link,
    '',
    parts.ignoreBn,
    '',
    '---',
    '',
    parts.greetingEn,
    '',
    parts.bodyEn,
    parts.link,
    '',
    parts.ignoreEn,
  ].join('\n');
  const link = escapeHtml(parts.link);
  const paragraph = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">',
    paragraph(parts.greetingBn),
    paragraph(parts.bodyBn),
    `<p><a href="${link}">${escapeHtml(parts.button)}</a></p>`,
    paragraph(parts.ignoreBn),
    '<hr>',
    paragraph(parts.greetingEn),
    paragraph(parts.bodyEn),
    `<p><a href="${link}">${link}</a></p>`,
    paragraph(parts.ignoreEn),
    '</body></html>',
  ].join('\n');
  return { subject: parts.subject, text, html };
}

export function verifyEmailMessage(name: string, link: string, hours: number): AuthEmail {
  return render({
    subject: 'Sirat Leadership Olympiad: ইমেইল যাচাই করুন / Verify your email',
    greetingBn: `প্রিয় ${name},`,
    bodyBn: `Sirat Leadership Olympiad-এ আপনার ইমেইল ঠিকানা যাচাই করতে নিচের লিংকে যান। লিংকটি ${bn(hours)} ঘণ্টা কাজ করবে।`,
    ignoreBn: 'আপনি এটা না চেয়ে থাকলে এই ইমেইলটি উপেক্ষা করুন।',
    greetingEn: `Dear ${name},`,
    bodyEn: `To verify your email address for the Sirat Leadership Olympiad, open the link below. It works for ${hours} hours.`,
    ignoreEn: 'If you did not ask for this, you can ignore this email.',
    button: 'ইমেইল যাচাই করুন / Verify email',
    link,
  });
}

export function resetPasswordMessage(name: string, link: string, minutes: number): AuthEmail {
  return render({
    subject: 'Sirat Leadership Olympiad: পাসওয়ার্ড নতুন করুন / Reset your password',
    greetingBn: `প্রিয় ${name},`,
    bodyBn: `আপনার পাসওয়ার্ড নতুন করতে নিচের লিংকে যান। লিংকটি ${bn(minutes)} মিনিট কাজ করবে এবং একবারই ব্যবহার করা যাবে।`,
    ignoreBn: 'আপনি এটা না চেয়ে থাকলে কিছুই করতে হবে না; আপনার পাসওয়ার্ড যেমন আছে তেমনই থাকবে।',
    greetingEn: `Dear ${name},`,
    bodyEn: `To set a new password, open the link below. It works for ${minutes} minutes and only once.`,
    ignoreEn: 'If you did not ask for this, do nothing: your password stays as it is.',
    button: 'পাসওয়ার্ড নতুন করুন / Reset password',
    link,
  });
}
