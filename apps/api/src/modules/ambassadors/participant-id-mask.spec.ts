import {
  dammDigit,
  isParticipantId,
  MASKED_PARTICIPANT_ID_PATTERN,
  maskParticipantId,
} from '@sirat/shared';

/** The masked participant ID on the ambassador card (the full ID is the login secret; lead, 2026-11-11). */
describe('maskParticipantId', () => {
  const id = `ON4821093755${dammDigit('4821093755')}`;

  it('keeps the prefix and the last 3 characters only, in the shape the web accepts', () => {
    expect(isParticipantId(id)).toBe(true);
    const masked = maskParticipantId(id);
    expect(masked).toMatch(MASKED_PARTICIPANT_ID_PATTERN);
    expect(masked.startsWith('ON ')).toBe(true);
    expect(masked.endsWith(` ${id.slice(10)}`)).toBe(true);
    // Exactly the 3 last characters' digits survive: none of the 8 hidden digits does.
    expect(masked.replace(/\D/g, '')).toBe(id.slice(10));
    expect(masked).not.toContain(id.slice(2, 10));
  });

  it('never shows the full ID, and a value that is not an ID masks to bullets only', () => {
    expect(maskParticipantId(id)).not.toContain(id);
    for (const bad of ['', 'ON123', 'hello world 12345', `${id}9`])
      expect(maskParticipantId(bad)).not.toMatch(/[0-9A-Za-z]/);
  });
});
