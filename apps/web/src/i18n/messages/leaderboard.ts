import { defineMessages } from '../messages.ts';

/** Student leaderboard (/dashboard/leaderboard). Round names are data and stay as sent. */
export const leaderboardMessages = defineMessages({
  en: {
    title: 'Leaderboard',
    subtitlePublished: (round: string, updated: string) =>
      `Official results for ${round} · updated ${updated}`,
    subtitleUnpublished: 'Official results are published here after each round closes.',
    roundsLabel: 'Rounds',
    searchLabel: 'Search participants',
    searchPlaceholder: 'Search name or institution',
    caption: (round: string) => `Leaderboard for ${round}`,
    columns: { rank: 'Rank', name: 'Name', institution: 'Institution / status' },
    soon: {
      title: 'Results are not published yet',
      text: (round: string) => `Results for ${round} will appear here once they are published.`,
      textNoRound: 'Results will appear here once they are published.',
    },
    empty: {
      title: 'No participants found',
      searchText: (q: string) => `No one matches “${q}”. Try another name or institution.`,
      text: 'There are no participants in this round yet.',
      clear: 'Clear search',
    },
  },
  bn: {
    title: 'লিডারবোর্ড',
    subtitlePublished: (round: string, updated: string) =>
      `অফিসিয়াল ফলাফল: ${round} · সর্বশেষ আপডেট ${updated}`,
    subtitleUnpublished: 'প্রতিটি রাউন্ড শেষ হওয়ার পর অফিসিয়াল ফলাফল এখানে প্রকাশ করা হয়।',
    roundsLabel: 'রাউন্ড',
    searchLabel: 'অংশগ্রহণকারী খুঁজুন',
    searchPlaceholder: 'নাম বা প্রতিষ্ঠান লিখে খুঁজুন',
    caption: (round: string) => `লিডারবোর্ড: ${round}`,
    columns: { rank: 'অবস্থান', name: 'নাম', institution: 'প্রতিষ্ঠান / অবস্থা' },
    soon: {
      title: 'ফলাফল এখনো প্রকাশ হয়নি',
      text: (round: string) => `${round}-এর ফলাফল প্রকাশিত হলে এখানে দেখা যাবে।`,
      textNoRound: 'ফলাফল প্রকাশিত হলে এখানে দেখা যাবে।',
    },
    empty: {
      title: 'কোনো অংশগ্রহণকারী পাওয়া যায়নি',
      searchText: (q: string) =>
        `“${q}” দিয়ে কাউকে খুঁজে পাওয়া যায়নি। অন্য নাম বা প্রতিষ্ঠান দিয়ে চেষ্টা করুন।`,
      text: 'এই রাউন্ডে এখনো কোনো অংশগ্রহণকারী নেই।',
      clear: 'সার্চ মুছে দিন',
    },
  },
});
