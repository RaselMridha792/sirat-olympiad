import { defineMessages } from '../messages.ts';

/*
 * The About page (owner, 2026-11-03). It reuses the homepage's intro, goals, quote and last season's numbers
 * (homeMessages: the client's PDF puts the same text and the same numbers on both pages). What is only here comes
 * from the old site's About page where the PDFs do not contradict it: the purpose and the five goals. All of it is
 * "to confirm" with the client; English is our translation.
 */
export const aboutMessages = defineMessages({
  en: {
    title: 'About the olympiad',
    metaDescription:
      'What the Sirat Olympiad is and why it exists, its aims and goals, and last season in numbers.',
    hero: {
      kicker: 'About',
      title: 'The competition is the occasion; reading the Sirat is the aim',
      lead: 'The aim is not just to hold a competition. A set syllabus, a list of reliable books and a step-by-step structure together give the reading a shape. The exam is the occasion for that reading, not its goal.',
    },
    fiveGoals: {
      title: 'Our five goals',
      items: [
        'Encourage students and young people to read the Sirat.',
        'Build the habit of learning the Sirat from reliable sources.',
        'Bring the same opportunity to every division of the country.',
        'Build the practice of applying the lessons of the Sirat in personal life.',
        'Connect educational institutions and young organisers in one network.',
      ],
    },
    team: {
      kicker: 'Team',
      title: 'The people behind it',
      advisers: 'Advisory board',
      advisersLead: 'They set the syllabus and oversee the quality of the questions.',
      convenors: 'Convenor team',
      convenorsLead: 'Planning and overall management.',
    },
  },
  bn: {
    title: 'অলিম্পিয়াড পরিচিতি',
    metaDescription: 'সিরাত অলিম্পিয়াড কী ও কেন, এর লক্ষ্য ও উদ্দেশ্য, আর সংখ্যায় গত আসর।',
    hero: {
      kicker: 'পরিচিতি',
      title: 'প্রতিযোগিতা উপলক্ষ, উদ্দেশ্য সিরাত পাঠ',
      lead: 'উদ্দেশ্য কেবল একটি প্রতিযোগিতা আয়োজন নয়। একটি নির্ধারিত সিলেবাস, নির্ভরযোগ্য বইয়ের তালিকা আর ধাপে ধাপে এগোনোর কাঠামো—এই তিনটি মিলিয়ে পড়াশোনাটাকে একটা আকার দেওয়া। পরীক্ষা সেই পড়াশোনার উপলক্ষ, লক্ষ্য নয়।',
    },
    fiveGoals: {
      title: 'আমাদের পাঁচটি লক্ষ্য',
      items: [
        'শিক্ষার্থী ও তরুণদের সিরাত পাঠে উৎসাহিত করা।',
        'নির্ভরযোগ্য উৎস থেকে সিরাত জানার অভ্যাস গড়ে তোলা।',
        'দেশের সব বিভাগে সমান সুযোগ পৌঁছে দেওয়া।',
        'সিরাতের শিক্ষা ব্যক্তিজীবনে প্রয়োগের চর্চা তৈরি করা।',
        'শিক্ষাপ্রতিষ্ঠান ও তরুণ সংগঠকদের একটি নেটওয়ার্কে যুক্ত করা।',
      ],
    },
    team: {
      kicker: 'টিম',
      title: 'যাঁরা পেছনে আছেন',
      advisers: 'উপদেষ্টা পর্ষদ',
      advisersLead: 'সিলেবাস নির্ধারণ ও প্রশ্নের মান তদারকিতে যাঁরা আছেন।',
      convenors: 'কনভেনার টিম',
      convenorsLead: 'পরিকল্পনা ও সার্বিক পরিচালনা।',
    },
  },
});
