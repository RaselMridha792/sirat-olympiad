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
      tasks: 'Ambassador tasks',
      teams: 'Teams',
      rounds: 'Rounds',
      jury: 'Jury',
      certificates: 'Certificates',
      announcements: 'Announcements',
      payments: 'Payments',
      settings: 'Settings',
      book: 'Free book',
      bookOrders: 'Book orders',
      audit: 'Audit log',
      security: 'Sign-in security',
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
      tasks: 'অ্যাম্বাসেডরের কাজ',
      teams: 'টিম',
      rounds: 'রাউন্ড',
      jury: 'জুরি',
      certificates: 'সার্টিফিকেট',
      announcements: 'ঘোষণা',
      payments: 'পেমেন্ট',
      settings: 'সেটিংস',
      book: 'ফ্রি বই',
      bookOrders: 'বইয়ের অর্ডার',
      audit: 'অডিট লগ',
      security: 'লগইন নিরাপত্তা',
    },
  },
});

export type AdminShellMessages = (typeof adminShellMessages)['en'];
