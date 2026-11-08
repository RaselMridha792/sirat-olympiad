import { defineMessages } from '../messages.ts';

/**
 * The mark on demo rows in the admin lists (demo data, DECISIONS 2026-11-08 "Demo data"), so nobody takes a demo row
 * for a real one during a client demo.
 */
export const demoBadgeMessages = defineMessages({
  en: { label: 'Demo' },
  bn: { label: 'ডেমো' },
});
