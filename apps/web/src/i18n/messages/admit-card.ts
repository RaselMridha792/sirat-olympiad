import { defineMessages } from '../messages.ts';

/**
 * The admit card (/dashboard/admit-card; core A1, the client's mock-up). The participant ID is the login secret: the
 * page shows it in full with a keep-private note, the PDF (A2, the student's own print) too, and the share image
 * carries only its masked form.
 */
export const admitCardMessages = defineMessages({
  en: {
    title: 'Admit card and exam ID',
    mode: { online: 'Online', offline: 'Offline' },
    idLabel: 'Participant ID',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy. Select the ID and copy it yourself.',
    registered: 'Registration complete',
    keepPrivate:
      'This ID is part of your login, with your email. Keep it private: never post it or send it to anyone.',
    fields: {
      name: 'Full name',
      category: 'Category',
      exam: 'Exam date and time',
      classFee: 'Class and fee',
    },
    examSoon: 'The date will be announced soon',
    examTime: (from: string, to: string) => `${from} to ${to}`,
    share: 'Share',
    shareHint: 'The shared image shows your ID masked: only its last 2 characters.',
    shareFailed: 'Sharing did not work. Try again, or take a screenshot.',
    pdf: {
      button: 'Download PDF',
      preparing: 'Preparing the PDF…',
      done: 'The PDF is saved.',
      hint: 'The PDF shows your full ID, for your own printout. Keep the printout private.',
      slow: 'The PDF is taking longer than usual. Try again in a minute.',
      failed: 'The PDF could not be made right now. Try again later.',
    },
    imageHeading: 'I am taking part!',
    imageId: 'Participant ID',
    countdown: {
      title: 'Time until the exam',
      units: { days: 'Days', hours: 'Hours', minutes: 'Minutes', seconds: 'Seconds' },
      started: 'The exam has started.',
      soon: 'The countdown starts when the exam date is announced.',
      startsAt: (when: string) => `The exam starts on ${when}.`,
      online: 'Online candidates: make sure you are signed in at the set time.',
      offline: 'Be at your centre 60 minutes before the exam starts.',
    },
    groups: {
      title: 'Join the official groups',
      soon: 'The links to the official groups will appear here soon.',
      items: {
        whatsapp: { title: 'Official WhatsApp group', text: 'Syllabus talk and updates' },
        telegram: { title: 'Telegram channel and quiz route', text: 'Daily quizzes and tips' },
        facebook: { title: 'Facebook group', text: 'Questions and discussion' },
        youtube: { title: 'YouTube channel', text: 'Video classes and guides' },
      },
      opens: (name: string) => `${name} (opens in a new tab)`,
    },
    notRegistered: {
      title: 'Your registration is not complete yet',
      text: 'Your admit card appears here once your registration and payment are complete.',
    },
  },
  bn: {
    title: 'প্রবেশপত্র ও পরীক্ষার আইডি',
    mode: { online: 'অনলাইন', offline: 'অফলাইন' },
    idLabel: 'পার্টিসিপেন্ট আইডি (PARTICIPANT ID)',
    copy: 'কপি',
    copied: 'কপি হয়েছে',
    copyFailed: 'কপি করা যায়নি। আইডিটি সিলেক্ট করে নিজে কপি করুন।',
    registered: 'রেজিস্ট্রেশন সম্পন্ন',
    keepPrivate:
      'এই আইডি ইমেইলের সাথে আপনার লগইনের অংশ। গোপন রাখুন: কোথাও পোস্ট করবেন না, কাউকে পাঠাবেন না।',
    fields: {
      name: 'পরীক্ষার্থীর পুরো নাম',
      category: 'পরীক্ষার্থীর শাখা (Category)',
      exam: 'পরীক্ষার তারিখ ও সময়',
      classFee: 'শ্রেণি ও ফি',
    },
    examSoon: 'তারিখ শিগগিরই জানানো হবে',
    examTime: (from: string, to: string) => `${from} থেকে ${to}`,
    share: 'শেয়ার করুন',
    shareHint: 'শেয়ার করা ছবিতে আপনার আইডি ঢাকা থাকে: শুধু শেষ ২টি অক্ষর দেখা যায়।',
    shareFailed: 'শেয়ার করা যায়নি। আবার চেষ্টা করুন, অথবা স্ক্রিনশট নিন।',
    pdf: {
      button: 'PDF ডাউনলোড',
      preparing: 'PDF তৈরি হচ্ছে…',
      done: 'PDF সেভ হয়েছে।',
      hint: 'PDF-এ আপনার পুরো আইডি থাকে, নিজের প্রিন্টের জন্য। প্রিন্ট কপিটি গোপন রাখুন।',
      slow: 'PDF তৈরিতে স্বাভাবিকের চেয়ে বেশি সময় লাগছে। এক মিনিট পর আবার চেষ্টা করুন।',
      failed: 'এই মুহূর্তে PDF তৈরি করা যায়নি। পরে আবার চেষ্টা করুন।',
    },
    imageHeading: 'আমি অংশ নিচ্ছি!',
    imageId: 'পার্টিসিপেন্ট আইডি',
    countdown: {
      title: 'পরীক্ষা শুরু হতে বাকি',
      units: { days: 'দিন', hours: 'ঘণ্টা', minutes: 'মিনিট', seconds: 'সেকেন্ড' },
      started: 'পরীক্ষা শুরু হয়ে গেছে।',
      soon: 'পরীক্ষার তারিখ জানানো হলে কাউন্টডাউন শুরু হবে।',
      startsAt: (when: string) => `পরীক্ষা শুরু: ${when}।`,
      online: 'অনলাইন পরীক্ষার্থীরা নির্ধারিত সময়ে লগইন নিশ্চিত করুন।',
      offline: 'পরীক্ষার ৬০ মিনিট আগে কেন্দ্রে উপস্থিত থাকুন।',
    },
    groups: {
      title: 'অফিসিয়াল গ্রুপে যোগ দিন',
      soon: 'অফিসিয়াল গ্রুপগুলোর লিংক শিগগিরই এখানে আসবে।',
      items: {
        whatsapp: { title: 'অফিসিয়াল হোয়াটসঅ্যাপ গ্রুপ', text: 'সিলেবাস আলোচনা ও আপডেট' },
        telegram: { title: 'টেলিগ্রাম চ্যানেল ও কুইজ রুট', text: 'প্রতিদিনের কুইজ ও টিপস' },
        facebook: { title: 'ফেসবুক গ্রুপ', text: 'প্রশ্নোত্তর ও আলোচনা' },
        youtube: { title: 'ইউটিউব চ্যানেল', text: 'ভিডিও ক্লাস ও গাইড' },
      },
      opens: (name: string) => `${name} (নতুন ট্যাবে খুলবে)`,
    },
    notRegistered: {
      title: 'আপনার রেজিস্ট্রেশন এখনো সম্পন্ন হয়নি',
      text: 'রেজিস্ট্রেশন ও পেমেন্ট সম্পন্ন হলে আপনার প্রবেশপত্র এখানে দেখা যাবে।',
    },
  },
});
