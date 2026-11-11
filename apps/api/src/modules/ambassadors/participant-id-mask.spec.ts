import {
  dammDigit,
  isParticipantId,
  MASKED_PARTICIPANT_ID_PATTERN,
  maskParticipantId,
} from '@sirat/shared';

/** The masked participant ID on the ambassador card (the full ID is the login secret; lead, 2026-11-11). */
describe('maskParticipantId', () => {
  const id = `ON4821093755${dammDigit('4821093755')}`;

  it('keeps the prefix and the last 2 characters only (a random digit and the check digit), in the shape the web accepts', () => {
    expect(isParticipantId(id)).toBe(true);
    const masked = maskParticipantId(id);
    expect(masked).toMatch(MASKED_PARTICIPANT_ID_PATTERN);
    expect(masked.startsWith('ON ')).toBe(true);
    expect(masked.endsWith(id.slice(11))).toBe(true);
    // Exactly the last 2 characters' digits survive: none of the 9 hidden digits does.
    expect(masked.replace(/\D/g, '')).toBe(id.slice(11));
    expect(masked).not.toContain(id.slice(2, 11));
    expect(masked).not.toContain(id.slice(10));
  });

  it('never shows the full ID, and a value that is not an ID masks to bullets only', () => {
    expect(maskParticipantId(id)).not.toContain(id);
    for (const bad of ['', 'ON123', 'hello world 12345', `${id}9`])
      expect(maskParticipantId(bad)).not.toMatch(/[0-9A-Za-z]/);
  });
});
