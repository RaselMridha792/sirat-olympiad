import { dhakaDays } from './admin-stats.service';

describe('dhakaDays', () => {
  it('gives the last 45 Asia/Dhaka calendar days, oldest first, and when the first one began', () => {
    // 18:30 UTC on 1 November is 00:30 on 2 November in Dhaka.
    const { days, start } = dhakaDays(new Date('2026-11-01T18:30:00Z'));
    expect(days).toHaveLength(45);
    expect(days[44]).toBe('2026-11-02');
    expect(days[0]).toBe('2026-09-19');
    expect(start.toISOString()).toBe('2026-09-18T18:00:00.000Z'); // 19 September 00:00 in Dhaka
    // Consecutive days, no gap or repeat across the month end.
    for (let i = 1; i < days.length; i += 1)
      expect(Date.parse(days[i]!) - Date.parse(days[i - 1]!)).toBe(86_400_000);
  });

  it('still counts a minute before Dhaka midnight as the earlier day', () => {
    const { days } = dhakaDays(new Date('2026-11-01T17:59:00Z')); // 23:59 on 1 November in Dhaka
    expect(days[44]).toBe('2026-11-01');
  });
});
