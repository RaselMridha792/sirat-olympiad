import { defineMessages } from '../messages.ts';

/** Student "My Exams" list (/dashboard/exam). Exam titles are data and stay as sent. */
export const studentExamsMessages = defineMessages({
  en: {
    title: 'My Exams',
    subtitle: 'Exams for your category. All times are Bangladesh time.',
    allCategories: 'All categories',
    minutes: (n: string) => `${n} min`,
    starts: 'Starts',
    ends: 'Ends',
    questions: 'Questions',
    /**
     * One line under the state badge. It never repeats the badge word or the Starts/Ends dates on
     * the card, so upcoming and closed exams have none. `submitted` stays after the window closes,
     * so its line makes no claim about time.
     */
    helper: {
      open: 'Start any time before it ends.',
      inProgress: 'Your timer is running.',
      submitted: 'Your answers are in. Results appear once they are published.',
    },
    /** The card's link into the exam room; closed exams have none. */
    action: {
      upcoming: 'Waiting room',
      open: 'Start',
      inProgress: 'Continue',
      submitted: 'Receipt',
    },
    empty: {
      title: 'No exams yet',
      description: 'Exams for your category will appear here once they are scheduled.',
    },
  },
  bn: {
    title: 'আমার পরীক্ষা',
    subtitle: 'আপনার ক্যাটাগরির পরীক্ষাগুলো। সময়গুলো বাংলাদেশ সময় অনুযায়ী দেখানো হয়েছে।',
    allCategories: 'সব ক্যাটাগরি',
    minutes: (n: string) => `${n} মিনিট`,
    starts: 'শুরু',
    ends: 'শেষ',
    questions: 'প্রশ্ন',
    helper: {
      open: 'শেষ হওয়ার আগে যেকোনো সময় শুরু করতে পারবেন।',
      inProgress: 'আপনার টাইমার চলছে।',
      // The badge already says "জমা হয়েছে", so this line uses other words.
      submitted: 'আপনার উত্তর পৌঁছে গেছে। ফলাফল প্রকাশিত হলে দেখা যাবে।',
    },
    action: {
      upcoming: 'অপেক্ষার ঘর',
      open: 'শুরু করুন',
      inProgress: 'চালিয়ে যান',
      submitted: 'রসিদ',
    },
    empty: {
      title: 'এখনো কোনো পরীক্ষা নেই',
      description: 'আপনার ক্যাটাগরির পরীক্ষা নির্ধারিত হলে এখানে দেখা যাবে।',
    },
  },
});
