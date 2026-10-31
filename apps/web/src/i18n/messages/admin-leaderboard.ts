import { defineMessages } from '../messages.ts';

/** Admin leaderboard (/admin/leaderboard), one snapshot per exam. Exam titles and participant names are data. */
export const adminLeaderboardMessages = defineMessages({
  en: {
    title: 'Leaderboard',
    subtitle: 'Full results with scores — staff only',
    publicStatus: {
      label: 'Students',
      live: 'Results published',
      hidden: 'Not published yet',
    },
    filters: {
      exams: 'Exams',
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
      caption: (exam: string) => `${exam} results`,
      rank: 'Rank',
      participant: 'Participant',
      category: 'Category',
      score: 'Score',
      time: 'Time',
      status: 'Status',
    },
    none: '—',
    empty: {
      notComputed: (exam: string) => `No results computed for ${exam} yet`,
      notComputedAny: 'No results computed yet',
      notComputedText:
        'Results appear here after the exam window closes for everyone and the snapshot is computed.',
      noMatch: 'No participants found',
      noMatchText: 'Try another name, email or institution.',
      noEntriesText: 'Nobody has a result in this exam yet.',
      clear: 'Clear search',
    },
  },
  bn: {
    title: 'লিডারবোর্ড',
    subtitle: 'নম্বরসহ পূর্ণ ফলাফল — শুধু স্টাফদের জন্য',
    publicStatus: {
      label: 'শিক্ষার্থীরা',
      live: 'ফলাফল প্রকাশিত',
      hidden: 'এখনো প্রকাশিত নয়',
    },
    filters: {
      exams: 'পরীক্ষা',
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
      caption: (exam: string) => `${exam}-এর ফলাফল`,
      rank: 'অবস্থান',
      participant: 'অংশগ্রহণকারী',
      category: 'ক্যাটাগরি',
      score: 'নম্বর',
      time: 'সময়',
      status: 'অবস্থা',
    },
    none: '—',
    empty: {
      notComputed: (exam: string) => `${exam}-এর ফলাফল এখনো হিসাব করা হয়নি`,
      notComputedAny: 'এখনো কোনো ফলাফল হিসাব করা হয়নি',
      notComputedText: 'সবার পরীক্ষার সময় শেষ হলে ফলাফল হিসাব করা হয়, তারপর এখানে দেখা যাবে।',
      noMatch: 'কোনো অংশগ্রহণকারী পাওয়া যায়নি',
      noMatchText: 'অন্য নাম, ইমেইল বা প্রতিষ্ঠান দিয়ে চেষ্টা করুন।',
      noEntriesText: 'এই পরীক্ষায় এখনো কারো ফলাফল নেই।',
      clear: 'সার্চ মুছে দিন',
    },
  },
});
