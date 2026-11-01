import { defineMessages } from '../messages.ts';

/** Teams for admins (/admin/teams; core C5b-3). */
export const adminTeamsMessages = defineMessages({
  en: {
    title: 'Teams',
    subtitle: (n: string) => `Ambassadors’ teams. ${n} in total.`,
    search: { label: 'Search teams by name', placeholder: 'Team name' },
    table: {
      caption: 'Ambassador teams, newest first',
      team: 'Team',
      owner: 'Team lead',
      members: 'Members',
      state: 'New members',
      created: 'Created',
      details: 'Details',
    },
    open: 'Open',
    closed: 'Closed',
    closedNote: 'The team lead is no longer an ambassador, so no one new can join.',
    viewDetails: (name: string) => `Details of ${name}`,
    empty: {
      title: 'No teams',
      none: 'No ambassador has started a team yet.',
      filtered: 'No team matches this search.',
    },
    detail: {
      notFoundTitle: 'Team not found',
      notFoundText: 'This team does not exist.',
      members: 'Members',
      joined: 'Joined',
    },
    rename: {
      button: 'Rename',
      title: 'Rename this team',
      text: 'Team names are shown to other students. Use this when a name is not suitable. The reason is kept in the audit log; the names are not.',
      name: 'New name',
      reason: 'Reason',
      submit: 'Rename',
    },
  },
  bn: {
    title: 'টিম',
    subtitle: (n: string) => `অ্যাম্বাসেডরদের টিম। মোট ${n}টি।`,
    search: { label: 'নাম দিয়ে টিম খুঁজুন', placeholder: 'টিমের নাম' },
    table: {
      caption: 'অ্যাম্বাসেডরদের টিম, নতুনগুলো আগে',
      team: 'টিম',
      owner: 'টিম লিড',
      members: 'সদস্য',
      state: 'নতুন সদস্য',
      created: 'তৈরি',
      details: 'বিস্তারিত',
    },
    open: 'চালু',
    closed: 'বন্ধ',
    closedNote: 'টিম লিড এখন আর অ্যাম্বাসেডর নন, তাই নতুন কেউ যোগ দিতে পারবে না।',
    viewDetails: (name: string) => `${name}-এর বিস্তারিত`,
    empty: {
      title: 'কোনো টিম নেই',
      none: 'এখনো কোনো অ্যাম্বাসেডর টিম শুরু করেননি।',
      filtered: 'এই খোঁজের সাথে কোনো টিম মেলেনি।',
    },
    detail: {
      notFoundTitle: 'টিম পাওয়া যায়নি',
      notFoundText: 'এই টিমটি নেই।',
      members: 'সদস্য',
      joined: 'যোগ দিয়েছেন',
    },
    rename: {
      button: 'নাম বদলান',
      title: 'এই টিমের নাম বদলান',
      text: 'টিমের নাম অন্য শিক্ষার্থীরা দেখে। নাম উপযুক্ত না হলে এটি ব্যবহার করুন। কারণটি অডিট লগে থাকবে, নামগুলো নয়।',
      name: 'নতুন নাম',
      reason: 'কারণ',
      submit: 'নাম বদলান',
    },
  },
});

export type AdminTeamsMessages = (typeof adminTeamsMessages)['en'];
