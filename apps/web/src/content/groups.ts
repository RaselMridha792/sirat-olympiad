/**
 * The official participant groups on the admit card (the client's mock-up; the lead's plan approval of 2026-11-11).
 * Each link stays hidden while its URL is empty: fill them in when the client sends them. Only https links leave
 * the site (safeExternalUrl), so a typo never becomes a link.
 */
export const OFFICIAL_GROUP_KEYS = ['whatsapp', 'telegram', 'facebook', 'youtube'] as const;
export type OfficialGroupKey = (typeof OFFICIAL_GROUP_KEYS)[number];

export const officialGroups: Readonly<Record<OfficialGroupKey, string>> = {
  whatsapp: '',
  telegram: '',
  facebook: '',
  youtube: '',
};
