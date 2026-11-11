import { pdfSelfCheck, SAMPLE_CARD } from './pdf-selfcheck';
import { isParticipantId } from '@sirat/shared';

describe('pdf selfcheck', () => {
  it('renders the sample card in both languages and reads its text back', async () => {
    const lines = await pdfSelfCheck();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^pdf selfcheck bn: \d+ KB, \d+ text runs, \d+ ms, HarfBuzz 14\.0\.0$/,
    );
    expect(lines[1]).toMatch(/^pdf selfcheck en: /);
  });

  it('uses an ID that no registration can have (its check digit is wrong)', () => {
    expect(isParticipantId(SAMPLE_CARD.participantId)).toBe(false);
  });
});
