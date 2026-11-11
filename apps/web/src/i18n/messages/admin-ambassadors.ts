import { defineMessages } from '../messages.ts';

/** /admin/ambassadors: ambassadors, their codes, referrals and points, and the approve/revoke dialog (also on /admin/users). */
export const adminAmbassadorsMessages = defineMessages({
  en: {
    title: 'Ambassadors',
    subtitle: (n: string) => `Track referrals, points and promo codes. ${n} found.`,
    search: {
      label: 'Search ambassadors by name, email or promo code',
      placeholder: 'Search name, email or code',
    },
    sort: { label: 'Order of the list', newest: 'Newest first', points: 'Most points first' },
    mobileFacts: (referrals: string, points: string) => `${referrals} referrals · ${points} points`,
    table: {
      caption: 'Ambassadors with their promo codes and referrals',
      ambassador: 'Ambassador',
      promoCode: 'Promo code',
      referrals: 'Referrals',
      points: 'Points',
      rank: 'Rank',
      approved: 'Approved',
      joined: 'Joined',
      actions: 'Actions',
    },
    revoked: 'Revoked',
    noRank: 'Not ranked yet',
    empty: {
      title: 'No ambassadors found',
      filtered: 'Try another name, email or code.',
      none: 'Ambassadors will appear here once they join.',
      showAll: 'Show all ambassadors',
    },
    action: {
      approve: 'Make ambassador',
      revoke: 'Revoke ambassador',
      approveTitle: 'Make this student an ambassador?',
      revokeTitle: 'Revoke this ambassador?',
      approveText:
        'The system gives them a promo code. New students who enter it at registration are counted as theirs. The code changes no fee.',
      revokeText:
        'Their code stops working for new registrations. Earlier referrals and points stay, and the code is never given to anyone else.',
      lag: 'The change reaches their pages at their next sign-in, or within 15 minutes.',
      reason: 'Reason',
      confirm: 'Yes, go ahead',
      pending: 'Working…',
      cancel: 'Cancel',
      errors: {
        reason: 'Write a reason of 3 to 200 characters.',
        notPaidStudent: 'Only a student with a paid registration can become an ambassador.',
        blocked: 'This account is blocked.',
        wrongRole: 'Staff accounts cannot be ambassadors.',
        notAmbassador: 'This account is not an ambassador now.',
        failed: 'It was not saved. Try again.',
      },
    },
    points: {
      title: 'Points and ranks',
      perReferral: (n: string) =>
        `${n} points for each paid registration with an ambassador's code`,
      ranks: 'Ranks',
      from: (n: string) => `from ${n}`,
      note: 'Points are added within 5 minutes of a registration; earlier points are never changed.',
      edit: 'Edit points and ranks',
      editTitle: 'Points and ranks',
      editText:
        'A new value counts for registrations from now on; points already given stay. The first rank starts at 0 and each rank needs more points than the one before.',
      perReferralLabel: 'Points per paid referral',
      rankName: 'Rank name',
      rankMin: 'From points',
      addRank: 'Add a rank',
      removeRank: (name: string) => `Remove the rank ${name}`,
      reason: 'Reason',
      save: 'Save',
      pending: 'Saving…',
      cancel: 'Cancel',
      errors: {
        badThresholds:
          'Start the first rank at 0, give each rank more points than the one before, and use distinct names of 2 to 30 characters.',
        stale: 'Another admin changed these values in the meantime. Close this and open it again.',
        invalid:
          'Check the values: points per referral from 0 to 1,000, and a reason of 3 to 200 characters.',
        failed: 'It was not saved. Try again.',
      },
    },
    adjust: {
      button: 'Adjust points',
      title: 'Adjust points',
      text: 'Adds a correction to the points history. Use a minus sign to take points away. Nothing earlier is changed.',
      amount: 'Points (+ or −)',
      reason: 'Reason',
      confirm: 'Add the correction',
      pending: 'Saving…',
      cancel: 'Cancel',
      errors: {
        invalid:
          'Enter a whole number from −10,000 to 10,000, not 0, and a reason of 3 to 200 characters.',
        notAmbassador: 'This account has never been an ambassador.',
        failed: 'It was not saved. Try again.',
      },
    },
  },
  bn: {
    title: 'অ্যাম্বাসেডর',
    subtitle: (n: string) => `রেফারেল, পয়েন্ট আর প্রোমো কোডের হিসাব। মোট ${n} জন।`,
    search: {
      label: 'নাম, ইমেইল বা প্রোমো কোড দিয়ে অ্যাম্বাসেডর খুঁজুন',
      placeholder: 'নাম, ইমেইল বা কোড লিখুন',
    },
    sort: { label: 'তালিকার ক্রম', newest: 'নতুনরা আগে', points: 'বেশি পয়েন্ট আগে' },
    mobileFacts: (referrals: string, points: string) =>
      `${referrals}টি রেফারেল · ${points} পয়েন্ট`,
    table: {
      caption: 'অ্যাম্বাসেডরদের প্রোমো কোড ও রেফারেলের তালিকা',
      ambassador: 'অ্যাম্বাসেডর',
      promoCode: 'প্রোমো কোড',
      referrals: 'রেফারেল',
      points: 'পয়েন্ট',
      rank: 'স্তর',
      approved: 'অনুমোদন',
      joined: 'যোগদান',
      actions: 'কাজ',
    },
    revoked: 'বাতিল করা',
    noRank: 'এখনো কোনো র‍্যাংক নেই',
    empty: {
      title: 'কোনো অ্যাম্বাসেডর পাওয়া যায়নি',
      filtered: 'অন্য নাম, ইমেইল বা কোড দিয়ে খুঁজুন।',
      none: 'কেউ অ্যাম্বাসেডর হিসেবে যুক্ত হলে এখানে দেখা যাবে।',
      showAll: 'সব অ্যাম্বাসেডর দেখুন',
    },
    action: {
      approve: 'অ্যাম্বাসেডর করুন',
      revoke: 'অ্যাম্বাসেডর বাতিল করুন',
      approveTitle: 'এই শিক্ষার্থীকে অ্যাম্বাসেডর করবেন?',
      revokeTitle: 'এই অ্যাম্বাসেডর বাতিল করবেন?',
      approveText:
        'সিস্টেম একটি প্রোমো কোড দেবে। রেজিস্ট্রেশনে নতুন শিক্ষার্থীরা কোডটি দিলে তাদের নামে গোনা হবে। কোডে ফি বদলায় না।',
      revokeText:
        'নতুন রেজিস্ট্রেশনে কোডটি আর কাজ করবে না। আগের রেফারেল আর পয়েন্ট থেকে যাবে, আর কোডটি কখনো অন্য কাউকে দেওয়া হবে না।',
      lag: 'পরিবর্তনটি তাদের পরের লগইনে, বা ১৫ মিনিটের মধ্যে, তাদের পাতায় দেখা যাবে।',
      reason: 'কারণ',
      confirm: 'হ্যাঁ, করুন',
      pending: 'হচ্ছে…',
      cancel: 'বাতিল',
      errors: {
        reason: '৩ থেকে ২০০ অক্ষরের মধ্যে কারণ লিখুন।',
        notPaidStudent: 'শুধু পেমেন্টসহ রেজিস্ট্রেশন করা শিক্ষার্থী অ্যাম্বাসেডর হতে পারে।',
        blocked: 'এই অ্যাকাউন্টটি ব্লক করা।',
        wrongRole: 'স্টাফ অ্যাকাউন্ট অ্যাম্বাসেডর হতে পারে না।',
        notAmbassador: 'এই অ্যাকাউন্টটি এখন অ্যাম্বাসেডর নয়।',
        failed: 'সংরক্ষণ হয়নি। আবার চেষ্টা করুন।',
      },
    },
    points: {
      title: 'পয়েন্ট ও র‍্যাঙ্ক',
      perReferral: (n: string) =>
        `অ্যাম্বাসেডরের কোড দিয়ে প্রতিটি পেমেন্টসহ রেজিস্ট্রেশনে ${n} পয়েন্ট`,
      ranks: 'র‍্যাঙ্ক',
      from: (n: string) => `${n} থেকে`,
      note: 'রেজিস্ট্রেশনের ৫ মিনিটের মধ্যে পয়েন্ট যোগ হয়; আগের পয়েন্ট কখনো বদলায় না।',
      edit: 'পয়েন্ট ও র‍্যাঙ্ক বদলান',
      editTitle: 'পয়েন্ট ও র‍্যাঙ্ক',
      editText:
        'নতুন মান এখন থেকে হওয়া রেজিস্ট্রেশনে গুনবে; আগে দেওয়া পয়েন্ট থেকে যাবে। প্রথম র‍্যাঙ্ক ০ থেকে শুরু, আর প্রতিটি র‍্যাঙ্কে আগেরটির চেয়ে বেশি পয়েন্ট লাগবে।',
      perReferralLabel: 'প্রতি পেমেন্টসহ রেফারেলে পয়েন্ট',
      rankName: 'র‍্যাঙ্কের নাম',
      rankMin: 'যত পয়েন্ট থেকে',
      addRank: 'র‍্যাঙ্ক যোগ করুন',
      removeRank: (name: string) => `${name} র‍্যাঙ্কটি সরান`,
      reason: 'কারণ',
      save: 'সংরক্ষণ করুন',
      pending: 'সংরক্ষণ হচ্ছে…',
      cancel: 'বাতিল',
      errors: {
        badThresholds:
          'প্রথম র‍্যাঙ্ক ০ থেকে শুরু করুন, প্রতিটি র‍্যাঙ্কে আগেরটির চেয়ে বেশি পয়েন্ট দিন, আর ২ থেকে ৩০ অক্ষরের আলাদা আলাদা নাম দিন।',
        stale: 'এর মধ্যে অন্য একজন অ্যাডমিন মানগুলো বদলেছেন। এটি বন্ধ করে আবার খুলুন।',
        invalid: 'মানগুলো দেখুন: প্রতি রেফারেলে ০ থেকে ১,০০০ পয়েন্ট, আর ৩ থেকে ২০০ অক্ষরের কারণ।',
        failed: 'সংরক্ষণ হয়নি। আবার চেষ্টা করুন।',
      },
    },
    adjust: {
      button: 'পয়েন্ট সমন্বয়',
      title: 'পয়েন্ট সমন্বয়',
      text: 'পয়েন্টের ইতিহাসে একটি সংশোধন যোগ করে। পয়েন্ট কমাতে বিয়োগ চিহ্ন দিন। আগের কিছুই বদলায় না।',
      amount: 'পয়েন্ট (+ বা −)',
      reason: 'কারণ',
      confirm: 'সংশোধন যোগ করুন',
      pending: 'সংরক্ষণ হচ্ছে…',
      cancel: 'বাতিল',
      errors: {
        invalid:
          '−১০,০০০ থেকে ১০,০০০-এর মধ্যে একটি পূর্ণ সংখ্যা দিন (০ নয়), আর ৩ থেকে ২০০ অক্ষরের কারণ।',
        notAmbassador: 'এই অ্যাকাউন্টটি কখনো অ্যাম্বাসেডর ছিল না।',
        failed: 'সংরক্ষণ হয়নি। আবার চেষ্টা করুন।',
      },
    },
  },
});
