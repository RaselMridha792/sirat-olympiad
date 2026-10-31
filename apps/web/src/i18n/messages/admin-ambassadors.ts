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
  },
  bn: {
    title: 'অ্যাম্বাসেডর',
    subtitle: (n: string) => `রেফারেল, পয়েন্ট আর প্রোমো কোডের হিসাব। মোট ${n} জন।`,
    search: {
      label: 'নাম, ইমেইল বা প্রোমো কোড দিয়ে অ্যাম্বাসেডর খুঁজুন',
      placeholder: 'নাম, ইমেইল বা কোড লিখুন',
    },
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
  },
});
