import { defineMessages } from '../messages.ts';

/*
 * The free book (payments PR 6b; plan §16): the student's page (/dashboard/book) and the dashboard card core's home
 * composes. The client form imports this module and picks the language itself (the page passes only the locale).
 */
export const bookMessages = defineMessages({
  en: {
    metaTitle: 'Free book',
    title: 'Your free book',
    intro: 'Every registered student gets one book, free. Tell us where to send it.',
    notEligible: {
      title: 'Available after your registration payment',
      text: 'Once your registration payment is confirmed, you can give your delivery address here.',
    },
    fields: {
      recipientName: "Recipient's name",
      recipientPhone: "Recipient's mobile number",
      phoneHint: 'The courier calls this number. It can be different from yours.',
      district: 'District',
      choose: 'Choose…',
      upazila: 'Upazila or thana',
      addressLine: 'Address (house, road, area)',
      note: 'Note for the courier (optional)',
    },
    submitFirst: 'Confirm the address',
    submitChange: 'Save the changes',
    saving: 'Saving…',
    cancel: 'Cancel',
    saved: 'Saved.',
    invalid: {
      required: 'Fill this in.',
      choose: 'Choose one.',
      recipientName: 'Enter a name (up to 100 characters).',
      recipientPhone: 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
      upazila: 'Enter the upazila or thana (2 to 100 characters).',
      addressLine: 'Enter the address (5 to 300 characters).',
      note: 'The note can have up to 300 characters.',
    },
    errors: {
      BOOK_NOT_ELIGIBLE: 'The book is available after your registration payment.',
      BOOK_ORDER_SHIPPED:
        'Your book has already been shipped, so the address can no longer change.',
      BOOK_ORDER_CHANGED:
        'The address was changed in another tab or on another device. Reload to see it.',
      invalid: 'Some details are not accepted. Check the form.',
      busy: 'The server is busy. Try again in a moment.',
      network: 'Could not reach the server. Check your connection and try again.',
    },
    order: {
      confirmedTitle: 'Order confirmed',
      confirmedText:
        'We will send your book to this address. You can change it until it is shipped.',
      shippedTitle: 'Your book has been shipped',
      shippedOn: (date: string) => `Shipped on ${date}.`,
      change: 'Change the address',
      book: 'Book',
      recipient: 'Recipient',
      phone: 'Mobile number',
      address: 'Address',
      note: 'Note',
    },
    card: {
      title: 'Free book',
      notEligible: 'Available after your registration payment.',
      none: 'Not ordered yet: confirm your delivery address.',
      confirmed: (district: string) => `Ordered, to be sent to ${district}.`,
      shipped: (date: string) => `Shipped on ${date}.`,
      confirm: 'Confirm the address',
      change: 'Change the address',
      view: 'See the order',
    },
  },
  bn: {
    metaTitle: 'ফ্রি বই',
    title: 'আপনার ফ্রি বই',
    intro: 'রেজিস্ট্রেশন করা প্রত্যেক ছাত্র একটি বই বিনামূল্যে পাবে। কোথায় পাঠাব জানান।',
    notEligible: {
      title: 'রেজিস্ট্রেশন পেমেন্টের পর পাওয়া যাবে',
      text: 'আপনার রেজিস্ট্রেশন পেমেন্ট নিশ্চিত হলে এখানে ডেলিভারির ঠিকানা দিতে পারবেন।',
    },
    fields: {
      recipientName: 'প্রাপকের নাম',
      recipientPhone: 'প্রাপকের মোবাইল নম্বর',
      phoneHint: 'কুরিয়ার এই নম্বরে ফোন করবে। এটি আপনার নম্বর থেকে আলাদা হতে পারে।',
      district: 'জেলা',
      choose: 'বেছে নিন…',
      upazila: 'উপজেলা বা থানা',
      addressLine: 'ঠিকানা (বাড়ি, রোড, এলাকা)',
      note: 'কুরিয়ারের জন্য নোট (ঐচ্ছিক)',
    },
    submitFirst: 'ঠিকানা নিশ্চিত করুন',
    submitChange: 'পরিবর্তন সংরক্ষণ করুন',
    saving: 'সংরক্ষণ হচ্ছে…',
    cancel: 'বাতিল',
    saved: 'সংরক্ষিত হয়েছে।',
    invalid: {
      required: 'এটি পূরণ করুন।',
      choose: 'একটি বেছে নিন।',
      recipientName: 'একটি নাম লিখুন (সর্বোচ্চ ১০০ অক্ষর)।',
      recipientPhone: 'বাংলাদেশি মোবাইল নম্বর দিন, যেমন 01712345678।',
      upazila: 'উপজেলা বা থানা লিখুন (২ থেকে ১০০ অক্ষর)।',
      addressLine: 'ঠিকানা লিখুন (৫ থেকে ৩০০ অক্ষর)।',
      note: 'নোট সর্বোচ্চ ৩০০ অক্ষরের হতে পারে।',
    },
    errors: {
      BOOK_NOT_ELIGIBLE: 'রেজিস্ট্রেশন পেমেন্টের পর বইটি পাওয়া যাবে।',
      BOOK_ORDER_SHIPPED: 'আপনার বই ইতিমধ্যে পাঠানো হয়েছে, তাই ঠিকানা আর বদলানো যাবে না।',
      BOOK_ORDER_CHANGED: 'অন্য কোনো ট্যাব বা ডিভাইসে ঠিকানাটি বদলানো হয়েছে। রিলোড করে দেখুন।',
      invalid: 'কিছু তথ্য গ্রহণ করা যায়নি। ফর্মটি মিলিয়ে দেখুন।',
      busy: 'সার্ভার এখন ব্যস্ত। একটু পরে আবার চেষ্টা করুন।',
      network: 'সার্ভারে পৌঁছানো গেল না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    },
    order: {
      confirmedTitle: 'অর্ডার নিশ্চিত হয়েছে',
      confirmedText: 'আপনার বই এই ঠিকানায় পাঠানো হবে। পাঠানোর আগ পর্যন্ত ঠিকানা বদলাতে পারবেন।',
      shippedTitle: 'আপনার বই পাঠানো হয়েছে',
      shippedOn: (date: string) => `পাঠানো হয়েছে ${date}।`,
      change: 'ঠিকানা বদলান',
      book: 'বই',
      recipient: 'প্রাপক',
      phone: 'মোবাইল নম্বর',
      address: 'ঠিকানা',
      note: 'নোট',
    },
    card: {
      title: 'ফ্রি বই',
      notEligible: 'রেজিস্ট্রেশন পেমেন্টের পর পাওয়া যাবে।',
      none: 'এখনো অর্ডার হয়নি: ডেলিভারির ঠিকানা নিশ্চিত করুন।',
      confirmed: (district: string) => `অর্ডার হয়েছে, ${district}-এ পাঠানো হবে।`,
      shipped: (date: string) => `পাঠানো হয়েছে ${date}।`,
      confirm: 'ঠিকানা নিশ্চিত করুন',
      change: 'ঠিকানা বদলান',
      view: 'অর্ডার দেখুন',
    },
  },
});

export type BookMessages = (typeof bookMessages)['en'];
