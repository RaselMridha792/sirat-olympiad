import { defineMessages } from '../messages.ts';

/**
 * The student's review (/dashboard/exam/[id]/review): own score, rank and time, each question with their answer,
 * the correct option and the explanation, only after the results are published (owner Q5).
 */
export const examReviewMessages = defineMessages({
  en: {
    title: 'Your results',
    stats: {
      score: 'Score',
      scoreValue: (score: string, total: string) => `${score} / ${total}`,
      rank: 'Rank',
      rankValue: (rank: string) => `#${rank}`,
      noRank: 'Not ranked',
      time: 'Time taken',
      noTime: '—',
    },
    question: (i: string, n: string) => `Question ${i} of ${n}`,
    yourAnswer: 'Your answer',
    correctAnswer: 'Correct answer',
    notAnswered: 'Not answered',
    explanation: 'Explanation',
    notYet: {
      title: 'Results are not published yet',
      text: 'Your review appears here after the exam has closed for everyone and the results are published.',
    },
    noAttempt: 'You did not take this exam, so there is nothing to review.',
    back: 'Back to my exams',
    leaderboard: 'See the leaderboard',
  },
  bn: {
    title: 'আপনার ফলাফল',
    stats: {
      score: 'নম্বর',
      scoreValue: (score: string, total: string) => `${score} / ${total}`,
      rank: 'অবস্থান',
      rankValue: (rank: string) => `#${rank}`,
      noRank: 'অবস্থান নেই',
      time: 'সময় লেগেছে',
      noTime: '—',
    },
    question: (i: string, n: string) => `প্রশ্ন ${i} / ${n}`,
    yourAnswer: 'আপনার উত্তর',
    correctAnswer: 'সঠিক উত্তর',
    notAnswered: 'উত্তর দেওয়া হয়নি',
    explanation: 'ব্যাখ্যা',
    notYet: {
      title: 'ফলাফল এখনো প্রকাশ হয়নি',
      text: 'সবার জন্য পরীক্ষা শেষ হওয়ার পরে ফলাফল প্রকাশিত হলে আপনার উত্তরের বিশ্লেষণ এখানে দেখা যাবে।',
    },
    noAttempt: 'আপনি এই পরীক্ষায় অংশ নেননি, তাই দেখার মতো কিছু নেই।',
    back: 'আমার পরীক্ষায় ফিরুন',
    leaderboard: 'লিডারবোর্ড দেখুন',
  },
});
