import { defineMessages } from '../messages.ts';

/** /admin/ambassadors: read-only list of ambassadors, their codes, referrals and points. */
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
    },
    pendingApproval: 'Pending approval',
    noRank: 'Not ranked yet',
    empty: {
      title: 'No ambassadors found',
      filtered: 'Try another name, email or code.',
      none: 'Ambassadors will appear here once they join.',
      showAll: 'Show all ambassadors',
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
    },
    pendingApproval: 'অনুমোদনের অপেক্ষায়',
    noRank: 'এখনো কোনো র‍্যাংক নেই',
    empty: {
      title: 'কোনো অ্যাম্বাসেডর পাওয়া যায়নি',
      filtered: 'অন্য নাম, ইমেইল বা কোড দিয়ে খুঁজুন।',
      none: 'কেউ অ্যাম্বাসেডর হিসেবে যুক্ত হলে এখানে দেখা যাবে।',
      showAll: 'সব অ্যাম্বাসেডর দেখুন',
    },
  },
});
