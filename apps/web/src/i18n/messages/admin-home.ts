import { defineMessages } from '../messages.ts';

/** Admin home (/admin): system overview, KPIs and charts. Numbers arrive already localized. */
export const adminHomeMessages = defineMessages({
  en: {
    title: 'Admin dashboard',
    /** Jury members land here; their screens are not built yet, and the statistics are for admins and managers. */
    jury: {
      title: 'Jury',
      body: 'The jury screens are not ready yet. You will find your assigned scripts here once they are.',
    },
    hero: {
      title: 'System overview',
      subtitle: 'Registrations, payments and exam activity',
      updated: (time: string) => `Updated ${time}`,
      refresh: 'Refresh',
    },
    kpiHeading: 'Key figures',
    kpi: {
      registered: 'Registered',
      paid: 'Paid',
      pendingPayments: 'Pending payments',
      activeAttempts: 'Active attempts',
      submittedAttempts: 'Submitted attempts',
      secondRound: 'Second round',
      finalists: 'Finalists',
    },
    registrations: {
      title: (days: string) => `Registrations, last ${days} days`,
      subtitle: 'New registrations per day, Dhaka time',
      summary: (days: string, total: string, peak: string, peakDay: string, latest: string) =>
        `Line chart of daily registrations over the last ${days} days: ${total} in total, the highest was ${peak} on ${peakDay}, and ${latest} on the latest day.`,
      empty: 'No registrations in this period yet',
      /** Summary of the disclosure under the chart that shows every day's count as a table. */
      dataLabel: 'Show daily numbers',
      columns: { day: 'Date', count: 'Registrations' },
    },
    byCategory: {
      title: 'By category',
      subtitle: 'Share of all registrations',
      summary: (parts: string) => `Registrations by category: ${parts}.`,
      empty: 'No registrations yet',
      total: (count: string) => `Total registrations: ${count}`,
      columns: { category: 'Category', count: 'Registrations', share: 'Share of total' },
    },
    pipeline: {
      title: 'Pipeline',
      subtitle: 'From registration to the final round, as a share of everyone registered',
      summary: (parts: string) => `Pipeline from registration to the final round: ${parts}.`,
      empty: 'Nobody has registered yet',
      columns: { stage: 'Stage', count: 'Count', share: 'Share of registered' },
    },
    /** One entry of a chart summary, e.g. "Paid 812 (64%)". */
    part: (label: string, value: string, share: string) => `${label} ${value} (${share})`,
    partWithoutShare: (label: string, value: string) => `${label} ${value}`,
    percent: (value: string) => `${value}%`,
  },
  bn: {
    title: 'অ্যাডমিন ড্যাশবোর্ড',
    jury: {
      title: 'জুরি',
      body: 'জুরির স্ক্রিন এখনো তৈরি হয়নি। তৈরি হলে আপনাকে দেওয়া খাতাগুলো এখানে পাবেন।',
    },
    hero: {
      title: 'সিস্টেমের সার্বিক চিত্র',
      subtitle: 'নিবন্ধন, পেমেন্ট ও পরীক্ষার কার্যক্রম',
      updated: (time: string) => `সর্বশেষ আপডেট: ${time}`,
      refresh: 'রিফ্রেশ করুন',
    },
    kpiHeading: 'মূল পরিসংখ্যান',
    kpi: {
      registered: 'নিবন্ধিত',
      paid: 'পেমেন্ট সম্পন্ন',
      pendingPayments: 'অপেক্ষমাণ পেমেন্ট',
      activeAttempts: 'এখন পরীক্ষা দিচ্ছে',
      submittedAttempts: 'জমা হওয়া উত্তরপত্র',
      secondRound: 'দ্বিতীয় রাউন্ড',
      finalists: 'ফাইনালিস্ট',
    },
    registrations: {
      title: (days: string) => `গত ${days} দিনের নিবন্ধন`,
      subtitle: 'প্রতিদিনের নতুন নিবন্ধন, ঢাকার সময় অনুযায়ী',
      summary: (days: string, total: string, peak: string, peakDay: string, latest: string) =>
        `গত ${days} দিনের দৈনিক নিবন্ধনের লাইন চার্ট: মোট ${total}টি, সবচেয়ে বেশি ${peakDay} তারিখে ${peak}টি, আর সর্বশেষ দিনে ${latest}টি।`,
      empty: 'এই সময়ে এখনো কোনো নিবন্ধন হয়নি',
      dataLabel: 'প্রতিদিনের সংখ্যা দেখুন',
      columns: { day: 'তারিখ', count: 'নিবন্ধন' },
    },
    byCategory: {
      title: 'ক্যাটাগরি অনুযায়ী',
      subtitle: 'মোট নিবন্ধনে কোন ক্যাটাগরির কত অংশ',
      summary: (parts: string) => `ক্যাটাগরি অনুযায়ী নিবন্ধন: ${parts}।`,
      empty: 'এখনো কোনো নিবন্ধন হয়নি',
      total: (count: string) => `মোট নিবন্ধন: ${count}`,
      columns: { category: 'ক্যাটাগরি', count: 'নিবন্ধন', share: 'মোটের অংশ' },
    },
    pipeline: {
      title: 'ধাপে ধাপে অগ্রগতি',
      subtitle: 'নিবন্ধন থেকে ফাইনাল রাউন্ড পর্যন্ত; শতাংশ হিসাব করা হয়েছে মোট নিবন্ধিতদের মধ্যে',
      summary: (parts: string) => `নিবন্ধন থেকে ফাইনাল রাউন্ড পর্যন্ত অগ্রগতি: ${parts}।`,
      empty: 'এখনো কেউ নিবন্ধন করেনি',
      columns: { stage: 'ধাপ', count: 'সংখ্যা', share: 'নিবন্ধিতদের মধ্যে' },
    },
    part: (label: string, value: string, share: string) => `${label} ${value} (${share})`,
    partWithoutShare: (label: string, value: string) => `${label} ${value}`,
    percent: (value: string) => `${value}%`,
  },
});
