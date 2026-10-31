import { defineMessages } from '../messages.ts';

/**
 * Ambassador panel (/dashboard/ambassador). Rank, team and task names are data and stay as sent.
 * `count` arguments only choose the English plural; the shown number is already localized.
 */
export const ambassadorMessages = defineMessages({
  en: {
    title: 'Ambassador Panel',
    intro: 'Grow your network and track your progress.',
    code: {
      label: 'Your promo code',
      hint: 'Students enter this code when they register.',
      pending: 'Your code appears here after an admin approves you.',
      copy: 'Copy code',
      copied: 'Copied',
      copyFailed: 'Could not copy. Select the code and copy it yourself.',
    },
    stats: {
      referrals: 'Referrals',
      referralsHint: 'Students who registered with your code',
      points: 'Points',
      rank: 'Rank',
      toNext: (n: string, next: string, count: number) =>
        `${n} ${count === 1 ? 'point' : 'points'} to ${next}`,
      topRank: 'Top rank reached',
      noRank: 'Not ranked yet',
      unranked: 'Rank tiers are not set up yet',
    },
    progress: {
      title: 'Rank progress',
      current: 'Current rank',
      next: 'Next rank',
      label: (next: string) => `Progress to ${next}`,
      points: (n: string, count: number) => `${n} ${count === 1 ? 'point' : 'points'}`,
      /** The bar runs from the current tier's floor to the next tier's target, not from 0. */
      value: (points: string, floor: string, target: string) => `${points} (${floor} to ${target})`,
      topLabel: 'Rank progress',
      topValue: (points: string) => `Top rank reached · ${points} points`,
    },
    team: {
      title: 'Your team',
      members: (n: string, count: number) => `${n} ${count === 1 ? 'member' : 'members'}`,
      owner: 'Team owner',
      none: 'No team yet',
    },
    tasks: {
      title: 'Your tasks',
      points: (n: string, count: number) => `+${n} ${count === 1 ? 'point' : 'points'}`,
      empty: 'No tasks assigned yet',
      emptyHint: 'New tasks appear here when they are assigned to you.',
    },
    referrals: {
      title: 'Recent referrals',
      caption: 'Students who recently registered with your code',
      columns: { name: 'Name', institution: 'Institution', joined: 'Joined' },
      empty: 'No referrals yet',
      emptyHint: 'Share your code. Students who register with it appear here.',
    },
  },
  bn: {
    title: 'অ্যাম্বাসেডর প্যানেল',
    intro: 'নেটওয়ার্ক বাড়ান, নিজের অগ্রগতি দেখুন।',
    code: {
      label: 'আপনার প্রোমো কোড',
      hint: 'রেজিস্ট্রেশনের সময় শিক্ষার্থীরা এই কোডটি লিখবে।',
      pending: 'অ্যাডমিন আপনাকে অনুমোদন দিলে আপনার কোড এখানে দেখা যাবে।',
      copy: 'কোড কপি করুন',
      copied: 'কপি হয়েছে',
      copyFailed: 'কপি করা যায়নি। কোডটি সিলেক্ট করে নিজে কপি করুন।',
    },
    stats: {
      referrals: 'রেফারেল',
      referralsHint: 'যারা আপনার কোড দিয়ে রেজিস্ট্রেশন করেছে',
      points: 'পয়েন্ট',
      rank: 'র‍্যাংক',
      toNext: (n: string, next: string) => `${next} হতে আর ${n} পয়েন্ট দরকার`,
      topRank: 'সর্বোচ্চ র‍্যাংকে পৌঁছে গেছেন',
      noRank: 'এখনো র‍্যাংক নেই',
      unranked: 'র‍্যাংকের ধাপ এখনো ঠিক করা হয়নি',
    },
    progress: {
      title: 'র‍্যাংকের অগ্রগতি',
      current: 'বর্তমান র‍্যাংক',
      next: 'পরের র‍্যাংক',
      label: (next: string) => `${next} র‍্যাংকের দিকে অগ্রগতি`,
      points: (n: string) => `${n} পয়েন্ট`,
      value: (points: string, floor: string, target: string) =>
        `${points} (${floor} থেকে ${target})`,
      topLabel: 'র‍্যাংকের অগ্রগতি',
      topValue: (points: string) => `সর্বোচ্চ র‍্যাংকে পৌঁছে গেছেন · ${points} পয়েন্ট`,
    },
    team: {
      title: 'আপনার টিম',
      members: (n: string) => `${n} জন সদস্য`,
      owner: 'টিম লিডার',
      none: 'এখনো কোনো টিমে নেই',
    },
    tasks: {
      title: 'আপনার কাজ',
      points: (n: string) => `+${n} পয়েন্ট`,
      empty: 'এখনো কোনো কাজ দেওয়া হয়নি',
      emptyHint: 'নতুন কাজ দেওয়া হলে এখানে দেখা যাবে।',
    },
    referrals: {
      title: 'সাম্প্রতিক রেফারেল',
      caption: 'যারা সম্প্রতি আপনার কোড দিয়ে রেজিস্ট্রেশন করেছে',
      columns: { name: 'নাম', institution: 'প্রতিষ্ঠান', joined: 'যোগদান' },
      empty: 'এখনো কোনো রেফারেল নেই',
      emptyHint: 'আপনার কোড শেয়ার করুন। কেউ এই কোড দিয়ে রেজিস্ট্রেশন করলে এখানে দেখা যাবে।',
    },
  },
});
