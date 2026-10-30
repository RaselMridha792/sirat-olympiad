import { defineMessages } from '../messages.ts';

/** Admin leaderboard (/admin/leaderboard). Round names and participant names are data. */
export const adminLeaderboardMessages = defineMessages({
  en: {
    title: 'Leaderboard',
    subtitle: 'Full results with scores — staff only',
    publicStatus: { label: 'Public status', live: 'Live on site', hidden: 'Hidden' },
    filters: {
      rounds: 'Rounds',
      categories: 'Categories',
      allCategories: 'All',
      searchLabel: 'Search participants',
      searchPlaceholder: 'Name, email or institution',
    },
    snapshot: (when: string) => `Snapshot computed ${when}`,
    podium: {
      label: 'Top three',
      rank: (n: string) => `Rank ${n}`,
      timeTaken: 'Time taken',
    },
    rankNo: (n: string) => `#${n}`,
    points: (n: string) => `${n} pts`,
    table: {
      caption: (round: string) => `${round} results`,
      rank: 'Rank',
      participant: 'Participant',
      category: 'Category',
      score: 'Score',
      time: 'Time',
      status: 'Status',
    },
    none: '—',
    empty: {
      notComputed: (round: string) => `No results computed for ${round} yet`,
      notComputedAny: 'No results computed yet',
      notComputedText:
        'Results appear here after the exam window closes for everyone and the snapshot is computed.',
      noMatch: 'No participants found',
      noMatchText: 'Try another name, email, institution or category.',
      noEntriesText: 'Nobody has a result in this round yet.',
      clear: 'Clear filters',
    },
  },
  bn: {
    title: 'লিডারবোর্ড',
    subtitle: 'নম্বরসহ পূর্ণ ফলাফল — শুধু স্টাফদের জন্য',
    publicStatus: { label: 'প্রকাশের অবস্থা', live: 'সাইটে প্রকাশিত', hidden: 'লুকানো' },
    filters: {
      rounds: 'রাউন্ড',
      categories: 'ক্যাটাগরি',
      allCategories: 'সব',
      searchLabel: 'অংশগ্রহণকারী খুঁজুন',
      searchPlaceholder: 'নাম, ইমেইল বা প্রতিষ্ঠান',
    },
    snapshot: (when: string) => `ফলাফল হিসাব করা হয়েছে: ${when}`,
    podium: {
      label: 'সেরা তিনজন',
      rank: (n: string) => `অবস্থান ${n}`,
      timeTaken: 'সময় লেগেছে',
    },
    rankNo: (n: string) => `#${n}`,
    points: (n: string) => `${n} পয়েন্ট`,
    table: {
      caption: (round: string) => `${round}-এর ফলাফল`,
      rank: 'অবস্থান',
      participant: 'অংশগ্রহণকারী',
      category: 'ক্যাটাগরি',
      score: 'নম্বর',
      time: 'সময়',
      status: 'অবস্থা',
    },
    none: '—',
    empty: {
      notComputed: (round: string) => `${round}-এর ফলাফল এখনো হিসাব করা হয়নি`,
      notComputedAny: 'এখনো কোনো ফলাফল হিসাব করা হয়নি',
      notComputedText: 'সবার পরীক্ষার সময় শেষ হলে ফলাফল হিসাব করা হয়, তারপর এখানে দেখা যাবে।',
      noMatch: 'কোনো অংশগ্রহণকারী পাওয়া যায়নি',
      noMatchText: 'অন্য নাম, ইমেইল, প্রতিষ্ঠান বা ক্যাটাগরি দিয়ে চেষ্টা করুন।',
      noEntriesText: 'এই রাউন্ডে এখনো কারো ফলাফল নেই।',
      clear: 'ফিল্টার মুছে দিন',
    },
  },
});
