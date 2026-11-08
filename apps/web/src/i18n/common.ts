import { defineMessages } from './messages.ts';

/**
 * Strings shared by every dashboard screen and the root boundaries (states, 404, paging, enum
 * labels). The root error/loading/not-found files show `bn` and `en` side by side.
 */
export const common = defineMessages({
  en: {
    nav: {
      main: 'Main menu',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      skip: 'Skip to main content',
    },
    language: { label: 'Language', bn: 'বাংলা', en: 'English' },
    states: {
      loading: 'Loading…',
      errorTitle: 'Something went wrong',
      errorMessage: 'We could not load this page. Please check your connection and try again.',
      retry: 'Try again',
      saving: 'Saving…',
      close: 'Close',
    },
    /** 404 screens: the root one (both languages) and the ones inside the two dashboard shells. */
    notFound: {
      title: 'Page not found',
      text: 'The page you are looking for does not exist or has been moved.',
      back: 'Back to home',
    },
    pagination: {
      label: 'Pages',
      prev: 'Prev',
      next: 'Next',
      summary: (page: string, total: string) => `Page ${page} of ${total}`,
    },
    search: { submit: 'Search' },
    notProvided: 'Not provided',
    roles: {
      student: 'Student',
      ambassador: 'Ambassador',
      manager: 'Manager',
      jury: 'Jury',
      admin: 'Admin',
    },
    categories: { activist: 'Activist', ambassador: 'Ambassador', achiever: 'Achiever' },
    roundTypes: { quiz: 'Quiz', video: 'Video', final: 'Final' },
    entryStatus: {
      pending: 'Pending',
      submitted: 'Submitted',
      evaluated: 'Evaluated',
      promoted: 'Promoted',
      eliminated: 'Not promoted',
    },
    examStatus: { draft: 'Draft', published: 'Published', archived: 'Archived' },
    examState: {
      upcoming: 'Upcoming',
      open: 'Open now',
      in_progress: 'In progress',
      submitted: 'Submitted',
      closed: 'Closed',
    },
    paymentStatus: {
      initiated: 'Started',
      pending: 'Pending',
      paid: 'Paid',
      failed: 'Failed',
      expired: 'Expired',
      refunded: 'Refunded',
    },
    taskStatus: {
      assigned: 'Assigned',
      submitted: 'Submitted',
      approved: 'Approved',
      rejected: 'Rejected',
    },
  },
  bn: {
    nav: {
      main: 'প্রধান মেনু',
      openMenu: 'মেনু খুলুন',
      closeMenu: 'মেনু বন্ধ করুন',
      skip: 'মূল অংশে যান',
    },
    language: { label: 'ভাষা', bn: 'বাংলা', en: 'English' },
    states: {
      loading: 'লোড হচ্ছে…',
      errorTitle: 'কিছু একটা সমস্যা হয়েছে',
      // 'পৃষ্ঠা' means "page" everywhere in this module (also in pagination below).
      errorMessage: 'পৃষ্ঠাটি লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
      retry: 'আবার চেষ্টা করুন',
      saving: 'সংরক্ষণ হচ্ছে…',
      close: 'বন্ধ করুন',
    },
    notFound: {
      title: 'পৃষ্ঠাটি পাওয়া যায়নি',
      text: 'আপনি যে পৃষ্ঠাটি খুঁজছেন, সেটি নেই অথবা সরিয়ে নেওয়া হয়েছে।',
      back: 'হোমে ফিরে যান',
    },
    pagination: {
      label: 'পৃষ্ঠা',
      prev: 'আগের',
      next: 'পরের',
      summary: (page: string, total: string) => `পৃষ্ঠা ${page} / ${total}`,
    },
    search: { submit: 'খুঁজুন' },
    notProvided: 'দেওয়া হয়নি',
    roles: {
      student: 'শিক্ষার্থী',
      ambassador: 'অ্যাম্বাসেডর',
      manager: 'ম্যানেজার',
      jury: 'জুরি',
      admin: 'অ্যাডমিন',
    },
    categories: { activist: 'অ্যাক্টিভিস্ট', ambassador: 'অ্যাম্বাসেডর', achiever: 'অ্যাচিভার' },
    roundTypes: { quiz: 'কুইজ', video: 'ভিডিও', final: 'ফাইনাল' },
    entryStatus: {
      pending: 'অপেক্ষমাণ',
      submitted: 'জমা হয়েছে',
      evaluated: 'মূল্যায়িত',
      promoted: 'পরের রাউন্ডে উত্তীর্ণ',
      eliminated: 'উত্তীর্ণ হয়নি',
    },
    examStatus: { draft: 'খসড়া', published: 'প্রকাশিত', archived: 'আর্কাইভ' },
    // open = the student may start now; in_progress = the student has started (timer running).
    // The badge is often shown on its own, so these two must not read as synonyms.
    examState: {
      upcoming: 'শীঘ্রই শুরু',
      open: 'এখন দেওয়া যাবে',
      in_progress: 'শুরু করেছেন',
      submitted: 'জমা হয়েছে',
      closed: 'বন্ধ',
    },
    paymentStatus: {
      initiated: 'শুরু হয়েছে',
      pending: 'অপেক্ষমাণ',
      paid: 'পরিশোধিত',
      failed: 'ব্যর্থ',
      expired: 'মেয়াদ শেষ',
      refunded: 'ফেরত দেওয়া হয়েছে',
    },
    taskStatus: {
      assigned: 'দেওয়া হয়েছে',
      submitted: 'জমা হয়েছে',
      approved: 'অনুমোদিত',
      rejected: 'গ্রহণ করা হয়নি', // not 'বাতিল', which reads as "cancelled"
    },
  },
});

export type CommonMessages = (typeof common)['en'];
