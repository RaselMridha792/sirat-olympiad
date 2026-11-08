import { defineMessages } from '../messages.ts';

/** Student dashboard frame: brand, navy top bar, sidebar links and the user chip. */
export const studentShellMessages = defineMessages({
  en: {
    // The brand stays in Latin script in both languages (it is a name).
    brand: 'Sirat Olympiad',
    topbarTitle: 'Dashboard',
    nav: {
      home: 'Dashboard',
      profile: 'My Profile',
      exams: 'My Exams',
      leaderboard: 'Leaderboard',
      announcements: 'Announcements',
      ambassador: 'Ambassador Panel',
      book: 'Free Book',
      round: 'My Round',
      certificates: 'Certificates',
      team: 'My Team',
    },
    /** Accessible name of the top-bar chip; starts with the visible text (the name). */
    userChip: (name: string) => `${name} — my profile`,
  },
  bn: {
    brand: 'Sirat Olympiad',
    topbarTitle: 'ড্যাশবোর্ড',
    nav: {
      home: 'ড্যাশবোর্ড',
      profile: 'আমার প্রোফাইল',
      exams: 'আমার পরীক্ষা',
      leaderboard: 'লিডারবোর্ড',
      announcements: 'ঘোষণা',
      ambassador: 'অ্যাম্বাসেডর প্যানেল',
      book: 'ফ্রি বই',
      round: 'আমার রাউন্ড',
      certificates: 'সার্টিফিকেট',
      team: 'আমার টিম',
    },
    userChip: (name: string) => `${name} — আমার প্রোফাইল`,
  },
});
