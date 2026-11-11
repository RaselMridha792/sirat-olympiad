import {
  dammDigit,
  formatParticipantId,
  isParticipantId,
  normalizeParticipantId,
  PARTICIPANT_ID_LENGTH,
} from '@sirat/shared';
import { registrationConfirmedMessage } from '../verify/registration-emails';

/** @sirat/shared's participant ID helpers (the database's rule is checked against them in participant-id.int-spec). */
const valid = (body: string, prefix = 'ON') => `${prefix}${body}${dammDigit(body)}`;

describe('participant ID helpers', () => {
  it("computes Damm's check digit (published example 572 -> 4) and accepts a valid ID", () => {
    expect(dammDigit('572')).toBe(4);
    expect(dammDigit('5724')).toBe(0);
    const id = valid('4821093755');
    expect(id).toHaveLength(PARTICIPANT_ID_LENGTH);
    expect(isParticipantId(id)).toBe(true);
    expect(isParticipantId(valid('0000000000', 'OF'))).toBe(true);
  });

  it('refuses every single-digit typo and adjacent swap, a wrong prefix, case and length', () => {
    const id = valid('4821093755');
    const digits = id.slice(2);
    for (let i = 0; i < digits.length; i++) {
      for (let d = 0; d <= 9; d++)
        if (String(d) !== digits[i])
          expect(isParticipantId(`ON${digits.slice(0, i)}${d}${digits.slice(i + 1)}`)).toBe(false);
      if (i + 1 < digits.length && digits[i] !== digits[i + 1])
        expect(
          isParticipantId(
            `ON${digits.slice(0, i)}${digits[i + 1]}${digits[i]}${digits.slice(i + 2)}`,
          ),
        ).toBe(false);
    }
    for (const bad of [id.toLowerCase(), `OX${digits}`, id.slice(0, 12), `${id}0`, '', 'ON'])
      expect(isParticipantId(bad)).toBe(false);
    expect(() => dammDigit('12a')).toThrow();
  });

  it('normalizes what a person types and formats for display', () => {
    const id = valid('4821093755');
    expect(
      normalizeParticipantId(` on ${id.slice(2, 6)}-${id.slice(6, 10)}.${id.slice(10)} `),
    ).toBe(id);
    expect(formatParticipantId(id)).toBe(`ON ${id.slice(2, 6)} ${id.slice(6, 10)} ${id.slice(10)}`);
    expect(normalizeParticipantId(formatParticipantId(id))).toBe(id);
    expect(formatParticipantId('not-an-id')).toBe('not-an-id');
  });
});

describe('the registration confirmation email', () => {
  it('carries the ID as the card shows it, in both languages, and escapes the name in HTML', () => {
    const id = valid('4821093755');
    const m = registrationConfirmedMessage('<b>Rahim</b>', id, 'https://sirat.test/login');
    const shown = formatParticipantId(id);
    expect(m.subject).toContain('Registration complete');
    expect(m.text.split(shown)).toHaveLength(3); // Bangla and English
    expect(m.html.split(shown)).toHaveLength(3);
    expect(m.text).toContain('https://sirat.test/login');
    expect(m.html).not.toContain('<b>Rahim</b>');
    expect(m.html).toContain('&lt;b&gt;Rahim&lt;/b&gt;');
    expect(m.text).toMatch(/private/);
  });
});
