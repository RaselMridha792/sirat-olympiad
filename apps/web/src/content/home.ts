/**
 * The homepage's facts, in one place (RULEBOOK §18). FIRST DRAFT (owner, 2026-11-03): taken from the client's two
 * PDFs, which win over the old site; every value here is "to confirm" with the client. The texts are in
 * i18n/messages/home.ts; the fee and whether registration is open come from the API, never from here.
 */
export interface RoadmapEntry {
  key:
    | 'registrationOpens'
    | 'registrationCloses'
    | 'selection'
    | 'selectionResult'
    | 'knockout'
    | 'final';
  /** Asia/Dhaka calendar days (YYYY-MM-DD); null while the date is to be announced. */
  from: string | null;
  to?: string;
}

export interface SocialLink {
  key: 'facebook' | 'instagram' | 'youtube' | 'telegram';
  url: string;
}

export interface HomeFacts {
  /** The client's Google Drive album of last season. Empty until the owner sends it; the link is hidden while empty. */
  albumUrl: string;
  /** Offline centres in the divisional cities: shown only once the client confirms them (one PDF has them). */
  offline: boolean;
  /** The knockout round's method: the content PDF says a video submission, the website PDF a viva. */
  knockoutMethod: 'video' | 'viva';
  /** How many reach the final from the knockout (both groups together). */
  knockoutQualifiers: number;
  /** The final's marks per episode. */
  finalMarksPerEpisode: number;
  /**
   * Prizes per group and their total value. The client's PDFs give the kinds of prizes but no counts; these are the
   * old site's figures, TO CONFIRM with the client.
   */
  prizes: {
    championsPerGroup: number;
    runnersUpPerGroup: number;
    finalistsPerGroup: number;
    /** The total value across both groups, in taka; null hides the line. */
    poolTaka: number | null;
  };
  roadmap: readonly RoadmapEntry[];
  social: readonly SocialLink[];
}

export const homeFacts: HomeFacts = {
  albumUrl: '',
  offline: false,
  knockoutMethod: 'video',
  knockoutQualifiers: 100,
  finalMarksPerEpisode: 10,
  prizes: {
    championsPerGroup: 1,
    runnersUpPerGroup: 1,
    finalistsPerGroup: 10,
    // The old site says 12,00,000 taka. A prize amount is a public promise of money: hidden (null) until the client
    // confirms it (lead, 2026-11-08).
    poolTaka: null,
  },
  // The PDFs give days without years; the season runs from Nov 2026 into 2027.
  roadmap: [
    { key: 'registrationOpens', from: '2026-11-25' },
    { key: 'registrationCloses', from: '2027-02-15' },
    { key: 'selection', from: '2027-03-19', to: '2027-03-20' },
    { key: 'selectionResult', from: null },
    { key: 'knockout', from: '2027-04-18' },
    { key: 'final', from: null },
  ],
  social: [
    { key: 'facebook', url: 'https://www.facebook.com/siratolympiad' },
    { key: 'instagram', url: 'https://www.instagram.com/SiratOlympiad' },
    { key: 'youtube', url: 'https://www.youtube.com/@siratolympiad' },
    { key: 'telegram', url: 'https://t.me/siratolympiad' },
  ],
};

/** Only https links leave the site; anything else is dropped (a typo in a pasted URL must not become a link). */
export function safeExternalUrl(url: string): string | null {
  const trimmed = url.trim();
  return /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#][^\s]*)?$/.test(trimmed) ? trimmed : null;
}
