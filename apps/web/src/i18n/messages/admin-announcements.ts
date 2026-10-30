import { defineMessages } from '../messages.ts';

/** Admin announcements list (/admin/announcements). Titles and bodies are data. */
export const adminAnnouncementsMessages = defineMessages({
  en: {
    title: 'Announcements',
    count: (n: string, total: number) => (total === 1 ? `${n} announcement` : `${n} announcements`),
    table: {
      caption: 'All announcements',
      details: 'Title and details',
      published: 'Published',
    },
    empty: {
      title: 'No announcements yet',
      text: 'Published announcements will appear here.',
    },
  },
  bn: {
    title: 'ঘোষণা',
    count: (n: string) => `${n}টি ঘোষণা`,
    table: {
      caption: 'সব ঘোষণা',
      details: 'শিরোনাম ও বিস্তারিত',
      published: 'প্রকাশের সময়',
    },
    empty: {
      title: 'এখনো কোনো ঘোষণা নেই',
      text: 'ঘোষণা প্রকাশ হলে এখানে দেখা যাবে।',
    },
  },
});
