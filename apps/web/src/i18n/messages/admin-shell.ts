import { defineMessages } from '../messages.ts';

/** Admin frame: sidebar brand, top bar and navigation labels. */
export const adminShellMessages = defineMessages({
  en: {
    brand: 'Sirat Admin',
    topbarTitle: 'Admin panel',
    nav: {
      dashboard: 'Dashboard',
      users: 'Users',
      exams: 'Exams',
      leaderboard: 'Leaderboard',
      ambassadors: 'Ambassadors',
      announcements: 'Announcements',
      payments: 'Payments',
      settings: 'Settings',
    },
  },
  bn: {
    // The brand name stays as it is in both languages.
    brand: 'Sirat Admin',
    topbarTitle: 'অ্যাডমিন প্যানেল',
    nav: {
      dashboard: 'ড্যাশবোর্ড',
      users: 'ব্যবহারকারী',
      exams: 'পরীক্ষা',
      leaderboard: 'লিডারবোর্ড',
      ambassadors: 'অ্যাম্বাসেডর',
      announcements: 'ঘোষণা',
      payments: 'পেমেন্ট',
      settings: 'সেটিংস',
    },
  },
});

export type AdminShellMessages = (typeof adminShellMessages)['en'];
