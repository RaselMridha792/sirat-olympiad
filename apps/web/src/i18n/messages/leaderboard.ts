import { defineMessages } from '../messages.ts';

/** Student leaderboard (/dashboard/leaderboard), one board per exam. Exam titles are data and stay as sent. */
export const leaderboardMessages = defineMessages({
  en: {
    title: 'Leaderboard',
    subtitlePublished: (exam: string, updated: string) =>
      `Official results for ${exam} · updated ${updated}`,
    subtitleUnpublished: 'Official results are published here after each exam closes.',
    examsLabel: 'Exams',
    searchLabel: 'Search participants',
    searchPlaceholder: 'Search name or institution',
    caption: (exam: string) => `Leaderboard for ${exam}`,
    columns: { rank: 'Rank', name: 'Name', institution: 'Institution / status' },
    soon: {
      title: 'Results are not published yet',
      text: (exam: string) => `Results for ${exam} will appear here once they are published.`,
      textNoExam: 'Results of your exams will appear here once they are published.',
    },
    empty: {
      title: 'No participants found',
      searchText: (q: string) => `No one matches “${q}”. Try another name or institution.`,
      text: 'There are no participants in this exam yet.',
      clear: 'Clear search',
    },
  },
  bn: {
    title: 'লিডারবোর্ড',
    subtitlePublished: (exam: string, updated: string) =>
      `অফিসিয়াল ফলাফল: ${exam} · সর্বশেষ আপডেট ${updated}`,
    subtitleUnpublished: 'প্রতিটি পরীক্ষা শেষ হওয়ার পর অফিসিয়াল ফলাফল এখানে প্রকাশ করা হয়।',
    examsLabel: 'পরীক্ষা',
    searchLabel: 'অংশগ্রহণকারী খুঁজুন',
    searchPlaceholder: 'নাম বা প্রতিষ্ঠান লিখে খুঁজুন',
    caption: (exam: string) => `লিডারবোর্ড: ${exam}`,
    columns: { rank: 'অবস্থান', name: 'নাম', institution: 'প্রতিষ্ঠান / অবস্থা' },
    soon: {
      title: 'ফলাফল এখনো প্রকাশ হয়নি',
      text: (exam: string) => `${exam}-এর ফলাফল প্রকাশিত হলে এখানে দেখা যাবে।`,
      textNoExam: 'আপনার পরীক্ষার ফলাফল প্রকাশিত হলে এখানে দেখা যাবে।',
    },
    empty: {
      title: 'কোনো অংশগ্রহণকারী পাওয়া যায়নি',
      searchText: (q: string) =>
        `“${q}” দিয়ে কাউকে খুঁজে পাওয়া যায়নি। অন্য নাম বা প্রতিষ্ঠান দিয়ে চেষ্টা করুন।`,
      text: 'এই পরীক্ষায় এখনো কোনো অংশগ্রহণকারী নেই।',
      clear: 'সার্চ মুছে দিন',
    },
  },
});
