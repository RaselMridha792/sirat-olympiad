import { defineMessages } from '../messages.ts';

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

/**
 * Student dashboard home (/dashboard). Round and exam names are data and stay as sent.
 * The exam rules are rendered from the next exam's own config (duration, questions, grace).
 */
export const studentHomeMessages = defineMessages({
  en: {
    metaTitle: 'Dashboard',
    hero: {
      eyebrow: 'Your learning hub',
      welcome: 'Welcome back,',
      lead: 'Your round, your next exam and the latest news, all in one place.',
      viewExams: 'View my exams',
      leaderboard: 'Leaderboard',
    },
    round: {
      label: 'Your current round',
      none: 'Your first round has not started yet.',
      noneHint: 'Watch the announcements for the start date.',
      noEntry: 'Your status for this round will appear here soon.',
      /** What to do next while the entry is pending, by round type. */
      pending: {
        quiz: 'Next step: take this round’s exam while its window is open.',
        video: 'Next step: submit your video before this round closes.',
        final: 'Next step: follow the announcements for the final schedule.',
      },
      status: {
        submitted: 'Your entry is in. Results come after the evaluation.',
        evaluated: 'Your entry has been evaluated. Results will be announced soon.',
        promoted: 'Congratulations! You have advanced to the next round.',
        eliminated: 'You did not advance this time. Thank you for taking part.',
      },
    },
    next: {
      title: 'Next exam',
      starts: 'Starts',
      ends: 'Ends',
      duration: 'Duration',
      questions: 'Questions',
      minutes: (n: string) => `${n} min`,
      link: 'Go to my exams',
      empty: 'No exam is scheduled right now. New exams will appear here.',
    },
    rules: {
      title: 'Important exam rules',
      subtitle: 'Please read these before you start an exam.',
      /** `n` is already localized; `count` only picks the plural form. */
      units: {
        minutes: (n: string, count: number) => `${n} ${plural(count, 'minute', 'minutes')}`,
        questions: (n: string, count: number) => `${n} ${plural(count, 'question', 'questions')}`,
        seconds: (n: string, count: number) => `${n} ${plural(count, 'second', 'seconds')}`,
      },
      attempt: {
        title: 'One attempt per exam',
        body: (time: string, questions: string) =>
          `You can take each exam once, at any time while its window is open. You get ${time} for ${questions}.`,
        bodyMax: (time: string) =>
          `You can take each exam once, at any time while its window is open. An exam lasts at most ${time}.`,
      },
      timer: {
        title: 'The timer never stops',
        body: 'Your timer starts when you begin the exam. It never pauses or resets, even if you lose your connection. If you start late, it stops when the window closes.',
      },
      saving: {
        title: 'Your answers are safe',
        body: 'Every answer is saved on your device and sent automatically. If the page refreshes, you can carry on where you left off while your time lasts.',
      },
      submit: {
        title: 'Automatic submission',
        body: (wait: string) =>
          `When your time is up, your current answers are submitted automatically. This can take up to ${wait}. Results appear after the window closes for everyone.`,
        bodyNoWait:
          'When your time is up, your current answers are submitted automatically. Results appear after the window closes for everyone.',
      },
      fair: {
        title: 'Play fair',
        body: 'Do not copy or share the questions. Switching to another device or browser does not give you extra time.',
      },
    },
    news: {
      title: 'Latest announcements',
      all: 'All announcements',
      empty: 'No announcements yet.',
    },
    registration: {
      title: 'Your registration',
      invoice: 'Invoice',
      amount: 'Fee',
      registeredOn: 'Registered on',
      payment: 'Payment',
      none: 'No registration is linked to this account yet.',
      unavailable:
        'Your registration status cannot be shown right now. Reload the page in a moment.',
      register: 'Register now',
    },
  },
  bn: {
    metaTitle: 'ড্যাশবোর্ড',
    hero: {
      eyebrow: 'আপনার শেখার জায়গা',
      welcome: 'আবারও স্বাগতম,',
      lead: 'আপনার রাউন্ড, পরের পরীক্ষা আর সর্বশেষ খবর, সব এক জায়গায়।',
      viewExams: 'আমার পরীক্ষাগুলো দেখুন',
      leaderboard: 'লিডারবোর্ড',
    },
    round: {
      label: 'আপনার বর্তমান রাউন্ড',
      none: 'আপনার প্রথম রাউন্ড এখনো শুরু হয়নি।',
      noneHint: 'শুরুর তারিখ জানতে ঘোষণাগুলো দেখুন।',
      noEntry: 'এই রাউন্ডে আপনার অবস্থা শিগগিরই এখানে দেখা যাবে।',
      pending: {
        quiz: 'পরের ধাপ: নির্ধারিত সময়ের মধ্যে এই রাউন্ডের পরীক্ষাটি দিন।',
        video: 'পরের ধাপ: রাউন্ড শেষ হওয়ার আগেই আপনার ভিডিও জমা দিন।',
        final: 'পরের ধাপ: ফাইনালের সময়সূচি জানতে ঘোষণাগুলো দেখুন।',
      },
      status: {
        submitted: 'আপনার জমা পৌঁছে গেছে। মূল্যায়নের পর ফলাফল জানানো হবে।',
        evaluated: 'আপনার জমা মূল্যায়ন করা হয়েছে। শিগগিরই ফলাফল জানানো হবে।',
        promoted: 'অভিনন্দন! আপনি পরের রাউন্ডে উঠেছেন।',
        eliminated: 'এবার পরের রাউন্ডে উঠতে পারেননি। অংশ নেওয়ার জন্য ধন্যবাদ।',
      },
    },
    next: {
      title: 'পরের পরীক্ষা',
      starts: 'শুরু',
      ends: 'শেষ',
      duration: 'সময়',
      questions: 'প্রশ্ন',
      minutes: (n: string) => `${n} মিনিট`,
      link: 'আমার পরীক্ষাগুলোতে যান',
      empty: 'এই মুহূর্তে কোনো পরীক্ষা নির্ধারিত নেই। নতুন পরীক্ষা এলে এখানে দেখা যাবে।',
    },
    rules: {
      title: 'পরীক্ষার গুরুত্বপূর্ণ নিয়ম',
      subtitle: 'পরীক্ষা শুরুর আগে নিয়মগুলো পড়ে নিন।',
      units: {
        minutes: (n: string) => `${n} মিনিট`,
        questions: (n: string) => `${n}টি প্রশ্ন`,
        seconds: (n: string) => `${n} সেকেন্ড`,
      },
      attempt: {
        title: 'প্রতিটি পরীক্ষা একবারই',
        body: (time: string, questions: string) =>
          `নির্ধারিত সময়ের মধ্যে যেকোনো সময় প্রতিটি পরীক্ষা একবারই দিতে পারবেন। মোট ${questions}, সময় ${time}।`,
        bodyMax: (time: string) =>
          `নির্ধারিত সময়ের মধ্যে যেকোনো সময় প্রতিটি পরীক্ষা একবারই দিতে পারবেন। একটি পরীক্ষার সময় সর্বোচ্চ ${time}।`,
      },
      timer: {
        title: 'টাইমার থামে না',
        body: 'পরীক্ষা শুরু করার সাথে সাথে টাইমার চালু হয়ে যাবে। ইন্টারনেট চলে গেলেও টাইমার থামবে না, নতুন করেও শুরু হবে না। দেরিতে শুরু করলে পরীক্ষার নির্ধারিত সময় শেষ হলেই আপনার সময়ও শেষ হবে।',
      },
      saving: {
        title: 'উত্তর হারাবে না',
        body: 'প্রতিটি উত্তর আপনার ডিভাইসে সংরক্ষিত থাকে এবং নিজে থেকেই পাঠানো হয়। পেজ রিফ্রেশ হলেও সময় থাকা পর্যন্ত যেখানে ছিলেন সেখান থেকেই আবার শুরু করতে পারবেন।',
      },
      submit: {
        title: 'নিজে থেকেই জমা হবে',
        body: (wait: string) =>
          `সময় শেষ হলে আপনার দেওয়া উত্তরগুলো নিজে থেকেই জমা হয়ে যাবে, এতে সর্বোচ্চ ${wait} লাগতে পারে। সবার পরীক্ষার সময় শেষ হলে ফলাফল প্রকাশ করা হবে।`,
        bodyNoWait:
          'সময় শেষ হলে আপনার দেওয়া উত্তরগুলো নিজে থেকেই জমা হয়ে যাবে। সবার পরীক্ষার সময় শেষ হলে ফলাফল প্রকাশ করা হবে।',
      },
      fair: {
        title: 'সততার সাথে পরীক্ষা দিন',
        body: 'প্রশ্ন কপি করবেন না, কারো সাথে শেয়ারও করবেন না। অন্য ডিভাইস বা ব্রাউজারে গেলে বাড়তি সময় পাওয়া যাবে না।',
      },
    },
    news: {
      title: 'সাম্প্রতিক ঘোষণা',
      all: 'সব ঘোষণা',
      empty: 'এখনো কোনো ঘোষণা নেই।',
    },
    registration: {
      title: 'আপনার রেজিস্ট্রেশন',
      invoice: 'ইনভয়েস',
      amount: 'ফি',
      registeredOn: 'রেজিস্ট্রেশনের তারিখ',
      payment: 'পেমেন্ট',
      none: 'এই অ্যাকাউন্টের সাথে এখনো কোনো রেজিস্ট্রেশন যুক্ত নেই।',
      unavailable:
        'এই মুহূর্তে রেজিস্ট্রেশনের অবস্থা দেখানো যাচ্ছে না। একটু পরে পাতাটি আবার খুলুন।',
      register: 'এখনই রেজিস্ট্রেশন করুন',
    },
  },
});
