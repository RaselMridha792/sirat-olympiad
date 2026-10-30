import { emailLink, escapeHtml, resetPasswordMessage, verifyEmailMessage } from './auth-emails';

const TOKEN = 'A'.repeat(43);

describe('auth emails', () => {
  it('builds links with the token after #, never in the path or query', () => {
    const link = emailLink('https://sirat.test', 'reset-password', TOKEN);
    expect(link).toBe(`https://sirat.test/reset-password#token=${TOKEN}`);
    expect(new URL(link).search).toBe('');
  });

  it('writes Bangla first, then English, with the link and lifetime in both', () => {
    const link = emailLink('https://sirat.test', 'verify-email', TOKEN);
    const mail = verifyEmailMessage('Ayesha', link, 24);
    expect(mail.subject).toContain('Verify your email');
    expect(mail.text.indexOf('প্রিয় Ayesha')).toBeLessThan(mail.text.indexOf('Dear Ayesha'));
    expect(mail.text.split(link)).toHaveLength(3); // once per language
    expect(mail.text).toContain('২৪ ঘণ্টা');
    expect(mail.text).toContain('24 hours');
    expect(mail.html).toContain(`href="${link}"`);
  });

  it('states the reset lifetime and that the link works once', () => {
    const mail = resetPasswordMessage(
      'Rahim',
      emailLink('https://sirat.test', 'reset-password', TOKEN),
      30,
    );
    expect(mail.text).toContain('৩০ মিনিট');
    expect(mail.text).toContain('30 minutes and only once');
  });

  it('escapes a hostile name in the HTML and keeps it as plain text in the text part', () => {
    const name = '<img src=x onerror=alert(1)> & "quotes"';
    const mail = resetPasswordMessage(
      name,
      emailLink('https://sirat.test', 'reset-password', TOKEN),
      30,
    );
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
    expect(mail.text).toContain(name);
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});
