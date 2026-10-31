import { defineMessages } from '../messages.ts';

/**
 * The exam room (/dashboard/exam/[id]): waiting room, rules, player, warnings, receipt. The rules say only what the
 * system really does (owner Q4; the old text claimed AI detection and screenshot monitoring, which never existed).
 */
export const examPlayerMessages = defineMessages({
  en: {
    letters: ['A', 'B', 'C', 'D', 'E', 'F'],
    loading: 'Loading the exam…',
    waiting: {
      opensIn: 'The exam opens in',
      opensAt: (when: string) => `Opens ${when} (Bangladesh time).`,
      closed: 'This exam has closed.',
      start: 'Start the exam',
      continue: 'Continue the exam',
      notYet: 'The Start button turns on when the exam opens.',
    },
    rules: {
      title: 'Before you start',
      duration: (n: string) =>
        `You have ${n} minutes. The timer runs on the server and keeps running if you leave.`,
      questions: (n: string) =>
        `${n} questions, one at a time. You can skip and come back with the question list.`,
      saved:
        'Your answers are saved on this device at once and on the server every minute or two. Reloading the page or losing the network does not count against you, and the timer keeps running.',
      leave:
        'Do not leave the exam. Switching to another tab or app, or opening developer tools, shows a warning.',
      end: (warnings: string, ending: string) =>
        `After ${warnings} warnings, the ${ending} time ends your exam and submits your current answers.`,
      recorded: 'Every such event is recorded with its time.',
      phone:
        'On a phone, turn on Do Not Disturb: a call or a notification can count as leaving the exam.',
      timeUp: 'When the time is up, your answers are submitted automatically.',
      agree: 'I have read these rules.',
      start: 'Start now',
      cancel: 'Not now',
    },
    player: {
      question: (i: string, n: string) => `Question ${i} of ${n}`,
      answered: (a: string, n: string) => `${a} of ${n} answered`,
      list: 'Questions',
      previous: 'Previous',
      next: 'Next',
      submit: 'Submit answers',
      timeLeft: 'Time left',
      warnings: (n: string, max: string) => `Warnings ${n}/${max}`,
      connection: {
        saved: 'Saved',
        saving: 'Saving…',
        unsaved: 'Saved on this device',
        offline: 'Offline: saved on this device',
      },
    },
    warning: {
      title: (n: string, max: string) => `Warning ${n}/${max}`,
      leave: 'You left the exam (another tab, app or window).',
      devtools: 'Developer tools are not allowed during the exam.',
      left: (n: string) => `${n} more and your exam ends with the answers you have given so far.`,
      last: 'One more and your exam ends with the answers you have given so far.',
      back: 'Return to exam',
    },
    ending: {
      violations: 'Exam ended',
      violationsBody: 'You left the exam too many times. Your current answers are being submitted.',
      time_up: 'Time is up',
      time_upBody: 'Your answers are being submitted.',
      submitted: 'Submitting',
      submittedBody: 'Your answers are being submitted.',
      retrying: 'No connection right now. Your answers are safe on this device; we keep trying.',
    },
    confirm: {
      title: 'Submit your answers?',
      unanswered: (n: string) => `${n} questions have no answer.`,
      allAnswered: 'Every question has an answer.',
      body: 'After you submit, you cannot change your answers.',
      submit: 'Submit',
      back: 'Keep working',
    },
    receipt: {
      title: 'Your answers are in',
      id: 'Receipt',
      at: 'Received',
      reason: {
        submitted: 'You submitted your answers.',
        time_up: 'Submitted automatically when the time was up.',
        violations: 'Submitted automatically after the last warning.',
        server_checkpoint: 'Submitted by the server from your last saved answers.',
        server_empty: 'No answers reached the server before the time was up.',
      },
      results:
        'Results appear after the exam has closed for everyone and the results are published.',
      back: 'Back to my exams',
    },
    closed: {
      time_over: 'The time for this exam is over. The server keeps your last saved answers.',
      already_submitted: 'This exam was already submitted (perhaps from another device).',
      session:
        'Your session has ended. Log in again: your answers are safe on this device and will be sent.',
      login: 'Log in',
    },
    errors: {
      not_open_yet: 'The exam is not open yet.',
      window_closed: 'This exam has closed.',
      email_unverified: 'Verify your email address before starting an exam.',
      registration_required: 'Starting an exam needs a paid registration.',
      account_blocked: 'This account cannot take exams. Contact the organisers.',
      generic: 'The exam could not be opened. Please try again.',
      retry: 'Try again',
    },
  },
  bn: {
    letters: ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'],
    loading: 'পরীক্ষা খুলছে…',
    waiting: {
      opensIn: 'পরীক্ষা খুলবে',
      opensAt: (when: string) => `খুলবে ${when} (বাংলাদেশ সময়)।`,
      closed: 'এই পরীক্ষা শেষ হয়ে গেছে।',
      start: 'পরীক্ষা শুরু করুন',
      continue: 'পরীক্ষা চালিয়ে যান',
      notYet: 'পরীক্ষা খুললে শুরুর বোতাম চালু হবে।',
    },
    rules: {
      title: 'শুরুর আগে',
      duration: (n: string) => `সময় ${n} মিনিট। টাইমার সার্ভারে চলে, আপনি বেরিয়ে গেলেও থামে না।`,
      questions: (n: string) =>
        `${n}টি প্রশ্ন, একবারে একটি করে। প্রশ্নের তালিকা থেকে বাদ দিয়ে আবার ফিরে আসতে পারবেন।`,
      saved:
        'আপনার উত্তর সঙ্গে সঙ্গে এই ডিভাইসে আর এক-দুই মিনিট পরপর সার্ভারে জমা থাকে। পেজ রিলোড করা বা নেটওয়ার্ক চলে যাওয়া লঙ্ঘন নয়, আর টাইমার চলতেই থাকে।',
      leave:
        'পরীক্ষা ছেড়ে যাবেন না। অন্য ট্যাব বা অ্যাপে গেলে, বা ডেভেলপার টুলস খুললে সতর্কবার্তা আসবে।',
      end: (warnings: string, ending: string) =>
        `${warnings}টি সতর্কবার্তার পরে ${ending}তম বারে পরীক্ষা শেষ হয়ে এখনকার উত্তর জমা হয়ে যাবে।`,
      recorded: 'এমন প্রতিটি ঘটনা সময়সহ রেকর্ড হয়।',
      phone:
        'ফোনে Do Not Disturb চালু রাখুন: কল বা নোটিফিকেশনও পরীক্ষা ছেড়ে যাওয়া হিসেবে গোনা হতে পারে।',
      timeUp: 'সময় শেষ হলে আপনার উত্তর নিজে থেকেই জমা হয়ে যাবে।',
      agree: 'আমি নিয়মগুলো পড়েছি।',
      start: 'এখন শুরু করুন',
      cancel: 'এখন নয়',
    },
    player: {
      question: (i: string, n: string) => `প্রশ্ন ${i} / ${n}`,
      answered: (a: string, n: string) => `${n}টির মধ্যে ${a}টির উত্তর দেওয়া হয়েছে`,
      list: 'প্রশ্নসমূহ',
      previous: 'আগের',
      next: 'পরের',
      submit: 'উত্তর জমা দিন',
      timeLeft: 'বাকি সময়',
      warnings: (n: string, max: string) => `সতর্কবার্তা ${n}/${max}`,
      connection: {
        saved: 'সংরক্ষিত',
        saving: 'সংরক্ষণ হচ্ছে…',
        unsaved: 'এই ডিভাইসে সংরক্ষিত',
        offline: 'অফলাইন: এই ডিভাইসে সংরক্ষিত',
      },
    },
    warning: {
      title: (n: string, max: string) => `সতর্কবার্তা ${n}/${max}`,
      leave: 'আপনি পরীক্ষা ছেড়ে গিয়েছিলেন (অন্য ট্যাব, অ্যাপ বা উইন্ডো)।',
      devtools: 'পরীক্ষার সময় ডেভেলপার টুলস ব্যবহার করা যাবে না।',
      left: (n: string) => `আর ${n}বার হলে এ পর্যন্ত দেওয়া উত্তর নিয়ে পরীক্ষা শেষ হয়ে যাবে।`,
      last: 'আর একবার হলে এ পর্যন্ত দেওয়া উত্তর নিয়ে পরীক্ষা শেষ হয়ে যাবে।',
      back: 'পরীক্ষায় ফিরুন',
    },
    ending: {
      violations: 'পরীক্ষা শেষ',
      violationsBody: 'আপনি অনেকবার পরীক্ষা ছেড়ে গেছেন। এখনকার উত্তর জমা দেওয়া হচ্ছে।',
      time_up: 'সময় শেষ',
      time_upBody: 'আপনার উত্তর জমা দেওয়া হচ্ছে।',
      submitted: 'জমা দেওয়া হচ্ছে',
      submittedBody: 'আপনার উত্তর জমা দেওয়া হচ্ছে।',
      retrying: 'এখন সংযোগ নেই। আপনার উত্তর এই ডিভাইসে নিরাপদ আছে; আমরা চেষ্টা করে যাচ্ছি।',
    },
    confirm: {
      title: 'উত্তর জমা দেবেন?',
      unanswered: (n: string) => `${n}টি প্রশ্নের উত্তর দেওয়া হয়নি।`,
      allAnswered: 'সব প্রশ্নের উত্তর দেওয়া হয়েছে।',
      body: 'জমা দেওয়ার পরে আর উত্তর বদলানো যাবে না।',
      submit: 'জমা দিন',
      back: 'আরও দেখি',
    },
    receipt: {
      title: 'আপনার উত্তর জমা হয়েছে',
      id: 'রসিদ',
      at: 'জমার সময়',
      reason: {
        submitted: 'আপনি নিজে উত্তর জমা দিয়েছেন।',
        time_up: 'সময় শেষ হওয়ায় নিজে থেকেই জমা হয়েছে।',
        violations: 'শেষ সতর্কবার্তার পরে নিজে থেকেই জমা হয়েছে।',
        server_checkpoint: 'আপনার শেষ সংরক্ষিত উত্তর থেকে সার্ভার জমা দিয়েছে।',
        server_empty: 'সময় শেষ হওয়ার আগে কোনো উত্তর সার্ভারে পৌঁছায়নি।',
      },
      results: 'সবার জন্য পরীক্ষা শেষ হওয়ার পরে ফলাফল প্রকাশিত হলে দেখা যাবে।',
      back: 'আমার পরীক্ষায় ফিরুন',
    },
    closed: {
      time_over: 'এই পরীক্ষার সময় শেষ। আপনার শেষ সংরক্ষিত উত্তর সার্ভারে থাকছে।',
      already_submitted: 'এই পরীক্ষা আগেই জমা হয়েছে (হয়তো অন্য ডিভাইস থেকে)।',
      session:
        'আপনার সেশন শেষ হয়েছে। আবার লগইন করুন: আপনার উত্তর এই ডিভাইসে নিরাপদ আছে এবং পাঠানো হবে।',
      login: 'লগইন',
    },
    errors: {
      not_open_yet: 'পরীক্ষা এখনো খোলেনি।',
      window_closed: 'এই পরীক্ষা শেষ হয়ে গেছে।',
      email_unverified: 'পরীক্ষা শুরুর আগে ইমেইল ঠিকানা যাচাই করুন।',
      registration_required: 'পরীক্ষা শুরু করতে পরিশোধিত নিবন্ধন লাগবে।',
      account_blocked: 'এই অ্যাকাউন্ট দিয়ে পরীক্ষা দেওয়া যাবে না। আয়োজকদের সাথে যোগাযোগ করুন।',
      generic: 'পরীক্ষা খোলা যায়নি। আবার চেষ্টা করুন।',
      retry: 'আবার চেষ্টা করুন',
    },
  },
});

export type ExamPlayerMessages = (typeof examPlayerMessages)['en'];
