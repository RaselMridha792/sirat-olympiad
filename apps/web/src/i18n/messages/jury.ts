import { defineMessages } from '../messages.ts';

/** The jury's page (/admin/jury; core C6b): blind scoring of the video round. */
export const juryMessages = defineMessages({
  en: {
    title: 'Jury',
    subtitle:
      'Score the videos of your categories. You see an entry number, never the student’s name. Each criterion is 0–10; the total is out of 100.',
    noRounds: {
      title: 'No round to score',
      text: 'An admin has not assigned you to a video round yet.',
    },
    notYet: (when: string) => `Scoring opens when the round closes: ${when}.`,
    tabs: { pending: 'To score', evaluated: 'Scored' },
    counts: (pending: string, evaluated: string) => `${pending} to score · ${evaluated} scored`,
    table: {
      caption: 'Sent videos, oldest first',
      entry: 'Entry',
      category: 'Category',
      video: 'Video',
      sent: 'Sent',
      mine: 'My total',
      action: 'Score',
    },
    openVideo: 'Open the video',
    videoNotLinked: 'Link not allowed',
    empty: {
      pending: 'Nothing left to score here.',
      evaluated: 'You have not scored anything here yet.',
    },
    score: {
      button: 'Score',
      again: 'Score again',
      title: (code: string) => `Score ${code}`,
      text: 'Give every criterion 0 to 10. Scoring again adds a new score; your latest one counts.',
      total: (value: string) => `Total: ${value} / 100`,
      comment: 'Note for the jury (optional, never shown to the student)',
      submit: 'Save the score',
      saved: (total: string, average: string, judges: string) =>
        `Saved: ${total} / 100. Average of ${judges} judge(s): ${average}.`,
    },
    cancel: 'Cancel',
    pending: 'Working…',
    errors: {
      bad_scores: 'Give every criterion a whole number from 0 to 10.',
      window_open: 'The round is still open: scoring starts when it closes.',
      already_promoted: 'This category has already been promoted: scoring is closed.',
      notFound: 'This entry is not in your categories, or it no longer exists.',
      limit: 'Too many requests. Wait a moment and try again.',
      invalid: 'Check what you entered.',
      failed: 'It did not work. Try again.',
    },
  },
  bn: {
    title: 'জুরি',
    subtitle:
      'আপনার ক্যাটাগরির ভিডিওগুলোতে নম্বর দিন। আপনি একটি এন্ট্রি নম্বর দেখবেন, শিক্ষার্থীর নাম কখনো নয়। প্রতিটি মানদণ্ডে ০–১০; মোট নম্বর ১০০-এর মধ্যে।',
    noRounds: {
      title: 'নম্বর দেওয়ার মতো কোনো রাউন্ড নেই',
      text: 'অ্যাডমিন এখনো আপনাকে কোনো ভিডিও রাউন্ডে যুক্ত করেননি।',
    },
    notYet: (when: string) => `রাউন্ড শেষ হলে নম্বর দেওয়া শুরু হবে: ${when}।`,
    tabs: { pending: 'নম্বর বাকি', evaluated: 'নম্বর দেওয়া' },
    counts: (pending: string, evaluated: string) =>
      `${pending}টি বাকি · ${evaluated}টিতে নম্বর দেওয়া`,
    table: {
      caption: 'পাঠানো ভিডিও, পুরোনোগুলো আগে',
      entry: 'এন্ট্রি',
      category: 'ক্যাটাগরি',
      video: 'ভিডিও',
      sent: 'পাঠানো',
      mine: 'আমার মোট',
      action: 'নম্বর',
    },
    openVideo: 'ভিডিওটি খুলুন',
    videoNotLinked: 'লিংক অনুমোদিত নয়',
    empty: {
      pending: 'এখানে নম্বর দেওয়ার আর কিছু বাকি নেই।',
      evaluated: 'আপনি এখনো এখানে কোনো নম্বর দেননি।',
    },
    score: {
      button: 'নম্বর দিন',
      again: 'আবার নম্বর দিন',
      title: (code: string) => `${code}-এ নম্বর দিন`,
      text: 'প্রতিটি মানদণ্ডে ০ থেকে ১০ দিন। আবার নম্বর দিলে নতুন নম্বর যোগ হয়; আপনার সর্বশেষটি গণ্য হয়।',
      total: (value: string) => `মোট: ${value} / ১০০`,
      comment: 'জুরির জন্য নোট (ঐচ্ছিক, শিক্ষার্থী কখনো দেখবে না)',
      submit: 'নম্বর সংরক্ষণ করুন',
      saved: (total: string, average: string, judges: string) =>
        `সংরক্ষিত: ${total} / ১০০। ${judges} জন বিচারকের গড়: ${average}।`,
    },
    cancel: 'বাতিল',
    pending: 'কাজ চলছে…',
    errors: {
      bad_scores: 'প্রতিটি মানদণ্ডে ০ থেকে ১০-এর মধ্যে একটি পূর্ণ সংখ্যা দিন।',
      window_open: 'রাউন্ড এখনো চলছে: শেষ হলে নম্বর দেওয়া শুরু হবে।',
      already_promoted: 'এই ক্যাটাগরি আগেই পরের রাউন্ডে তোলা হয়েছে: নম্বর দেওয়া বন্ধ।',
      notFound: 'এই এন্ট্রি আপনার ক্যাটাগরিতে নেই, অথবা আর নেই।',
      limit: 'অনেক বেশি অনুরোধ। একটু অপেক্ষা করে আবার চেষ্টা করুন।',
      invalid: 'যা লিখেছেন তা দেখে নিন।',
      failed: 'কাজটি হয়নি। আবার চেষ্টা করুন।',
    },
  },
});

export type JuryMessages = (typeof juryMessages)['en'];
