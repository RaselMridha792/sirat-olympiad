import { defineMessages } from '../messages.ts';

/** Student announcements (/dashboard/announcements). Titles and bodies are data (plain text). */
export const announcementsMessages = defineMessages({
  en: {
    title: 'Announcements',
    subtitle: 'News and updates from the Sirat Leadership Olympiad team.',
    badge: 'Update',
    empty: {
      title: 'No announcements yet',
      description: 'New updates from the organisers will appear here.',
    },
  },
  bn: {
    title: 'ঘোষণা',
    subtitle: 'সিরাত লিডারশিপ অলিম্পিয়াড টিমের খবর ও আপডেট।',
    badge: 'আপডেট',
    empty: {
      title: 'এখনো কোনো ঘোষণা নেই',
      description: 'আয়োজকদের নতুন আপডেট এখানে দেখা যাবে।',
    },
  },
});
