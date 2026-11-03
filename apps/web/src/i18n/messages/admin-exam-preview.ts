import { defineMessages } from '../messages.ts';

/**
 * The admin exam preview (/admin/exams/[id]/preview; D2). Question and option texts are data. The client component
 * picks these by locale itself (function leaves are not serializable).
 */
export const adminExamPreviewMessages = defineMessages({
  en: {
    metaTitle: 'Exam preview',
    open: 'Preview',
    openLabel: (title: string) => `Preview ${title}`,
    back: 'Back to the exam',
    banner:
      'Preview: one sample of what a student sees. Nothing is saved, no timer runs, and each student gets their own random order.',
    partial: (n: string, m: string) =>
      `This draft has ${n} of the ${m} questions an attempt needs.`,
    empty: 'This draft has no questions yet.',
    duration: (n: string) => `Duration: ${n} minutes`,
    questionOf: (i: string, n: string) => `Question ${i} of ${n}`,
    previous: 'Previous',
    next: 'Next',
    list: 'Questions',
    showAnswers: 'Show answers',
    hideAnswers: 'Hide answers',
    drawAgain: 'Draw again',
    correct: (letter: string, text: string) => `Correct answer: ${letter}. ${text}`,
  },
  bn: {
    metaTitle: 'পরীক্ষার প্রিভিউ',
    open: 'প্রিভিউ',
    openLabel: (title: string) => `${title} প্রিভিউ`,
    back: 'পরীক্ষায় ফিরে যান',
    banner:
      'প্রিভিউ: একজন শিক্ষার্থী যা দেখে তার একটি নমুনা। কিছু সংরক্ষণ হয় না, টাইমার চলে না, আর প্রত্যেক শিক্ষার্থী নিজের আলাদা এলোমেলো ক্রম পায়।',
    partial: (n: string, m: string) =>
      `এই খসড়ায় একবারের পরীক্ষার জন্য দরকারি ${m}টি প্রশ্নের মধ্যে ${n}টি আছে।`,
    empty: 'এই খসড়ায় এখনো কোনো প্রশ্ন নেই।',
    duration: (n: string) => `সময়: ${n} মিনিট`,
    questionOf: (i: string, n: string) => `প্রশ্ন ${i} / ${n}`,
    previous: 'আগের',
    next: 'পরের',
    list: 'প্রশ্নগুলো',
    showAnswers: 'উত্তর দেখান',
    hideAnswers: 'উত্তর লুকান',
    drawAgain: 'আবার নমুনা নিন',
    correct: (letter: string, text: string) => `সঠিক উত্তর: ${letter}. ${text}`,
  },
});
