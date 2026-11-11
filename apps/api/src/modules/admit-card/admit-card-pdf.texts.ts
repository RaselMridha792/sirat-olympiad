import type { AdmitCardPdfLocale, Category } from '@sirat/shared';

export interface AdmitCardPdfTexts {
  title: string;
  mode: Record<'online' | 'offline', string>;
  idLabel: string;
  keepPrivate: string;
  fields: Record<
    'name' | 'category' | 'gradeLevel' | 'fee' | 'exam' | 'examTime' | 'registeredAt' | 'mode',
    string
  >;
  categories: Record<Category, string>;
  notProvided: string;
  examSoon: string;
  examTime: (from: string, to: string) => string;
  paidOn: (date: string) => string;
  instructionsTitle: string;
  instructions: Record<'online' | 'offline', string>;
  printCopy: string;
}

/**
 * The admit card PDF's texts (core A2). They follow the web page's (apps/web/src/i18n/messages/admit-card.ts and the
 * category names in common.ts): a change there is a change here. The PDF never prints the email: with the full ID it
 * would carry both halves of the login (the lead, 2026-11-11).
 */
export const ADMIT_CARD_PDF_TEXTS: Record<AdmitCardPdfLocale, AdmitCardPdfTexts> = {
  en: {
    title: 'Admit card',
    mode: { online: 'Online', offline: 'Offline' },
    idLabel: 'Participant ID',
    keepPrivate:
      'This ID is part of your login, with your email. Keep it private: never post it, send it to anyone or share a photo of this card.',
    fields: {
      name: 'Full name',
      category: 'Category',
      gradeLevel: 'Class',
      fee: 'Fee',
      exam: 'Exam',
      examTime: 'Exam date and time',
      registeredAt: 'Registered on',
      mode: 'Exam mode',
    },
    categories: { activist: 'Activist', ambassador: 'Ambassador', achiever: 'Achiever' },
    notProvided: 'Not provided',
    examSoon: 'The date will be announced soon',
    examTime: (from: string, to: string) => `${from} to ${to}`,
    paidOn: (date: string) => `paid on ${date}`,
    instructionsTitle: 'Instructions',
    instructions: {
      online: 'Online candidates: make sure you are signed in at the set time.',
      offline: 'Be at your centre 60 minutes before the exam starts.',
    },
    printCopy:
      'This PDF is a print copy. The admit card page on the website always shows the latest details, including any change to the exam date.',
  },
  bn: {
    title: 'প্রবেশপত্র',
    mode: { online: 'অনলাইন', offline: 'অফলাইন' },
    idLabel: 'পার্টিসিপেন্ট আইডি (PARTICIPANT ID)',
    keepPrivate:
      'এই আইডি ইমেইলের সাথে আপনার লগইনের অংশ। গোপন রাখুন: কোথাও পোস্ট করবেন না, কাউকে পাঠাবেন না, এই কার্ডের ছবিও শেয়ার করবেন না।',
    fields: {
      name: 'পরীক্ষার্থীর পুরো নাম',
      category: 'পরীক্ষার্থীর শাখা (Category)',
      gradeLevel: 'শ্রেণি',
      fee: 'ফি',
      exam: 'পরীক্ষা',
      examTime: 'পরীক্ষার তারিখ ও সময়',
      registeredAt: 'রেজিস্ট্রেশনের তারিখ',
      mode: 'পরীক্ষার ধরন',
    },
    categories: { activist: 'অ্যাক্টিভিস্ট', ambassador: 'অ্যাম্বাসেডর', achiever: 'অ্যাচিভার' },
    notProvided: 'দেওয়া হয়নি',
    examSoon: 'তারিখ শিগগিরই জানানো হবে',
    examTime: (from: string, to: string) => `${from} থেকে ${to}`,
    paidOn: (date: string) => `পরিশোধ: ${date}`,
    instructionsTitle: 'নির্দেশনা',
    instructions: {
      online: 'অনলাইন পরীক্ষার্থীরা নির্ধারিত সময়ে লগইন নিশ্চিত করুন।',
      offline: 'পরীক্ষার ৬০ মিনিট আগে কেন্দ্রে উপস্থিত থাকুন।',
    },
    printCopy:
      'এই PDF একটি প্রিন্ট কপি। ওয়েবসাইটের প্রবেশপত্র পাতায় সবসময় সর্বশেষ তথ্য থাকে, পরীক্ষার তারিখের কোনো পরিবর্তনসহ।',
  },
};
