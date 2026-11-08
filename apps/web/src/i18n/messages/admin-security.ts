import { defineMessages } from '../messages.ts';

/**
 * Two-factor login for admins and managers (/admin/security; A2, 06-API "Two-factor login"). The client component
 * imports this module and picks the language itself (the page passes only the locale).
 */
export const adminSecurityMessages = defineMessages({
  en: {
    title: 'Sign-in security',
    intro:
      'Two-factor login: after your password, a 6-digit code from an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or 2FAS).',
    required:
      'Admins and managers must turn on two-factor login before any other admin page opens.',
    unavailable:
      'Two-factor login is not switched on on this server, so there is nothing to set up here.',
    on: 'On',
    off: 'Off',
    statusLabel: 'Two-factor login',
    recoveryLeft: (n: string) => `Unused recovery codes: ${n}`,
    recoveryLow: 'Few recovery codes are left. Make new ones below.',
    password: 'Your password',
    code: 'Code from the app',
    recoveryCode: 'Recovery code',
    useRecovery: 'Use a recovery code instead',
    useApp: 'Use a code from the app instead',
    setup: {
      title: 'Turn on two-factor login',
      step1: 'Step 1: confirm your password.',
      start: 'Start the setup',
      step2: 'Step 2: scan this QR code with your authenticator app.',
      qrAlt: 'QR code to add Sirat to your authenticator app',
      manual: 'Cannot scan it? Enter this key in the app by hand:',
      step3: 'Step 3: enter the 6-digit code the app now shows for Sirat.',
      enable: 'Turn on',
      startOver: 'Start over',
    },
    codes: {
      title: 'Your recovery codes',
      text: 'If you lose your phone, each of these codes signs you in once. Store them offline now (print them or write them down): they are not shown again.',
      copy: 'Copy the codes',
      copied: 'Copied',
      done: 'I have stored them',
    },
    renew: {
      title: 'New recovery codes',
      text: 'Makes 10 new recovery codes and cancels all the old ones. Confirm with a code from the app.',
      submit: 'Make new codes',
    },
    disable: {
      title: 'Turn off two-factor login',
      text: 'Admins and managers must set it up again before they can use the admin pages. Use this when you move to a new phone.',
      submit: 'Turn off',
    },
    working: 'Please wait…',
    invalidCode: 'Enter the 6-digit code from your authenticator app.',
    invalidRecovery: 'Enter a recovery code like ABCDE-FGH23.',
    problems: {
      wrongPassword: 'The password is incorrect.',
      wrongCode: 'The code is incorrect. Check that your phone’s time is set automatically.',
      setupAgain: 'This setup has ended. Start it again.',
      alreadyOn: 'Two-factor login is already on. Reload the page.',
      notOn: 'Two-factor login is not on. Reload the page.',
      tooMany: 'Too many attempts. Wait a few minutes and try again.',
      unavailable: 'Two-factor login is not switched on on this server.',
      failed: 'That did not work. Check your connection and try again.',
    },
  },
  bn: {
    title: 'লগইন নিরাপত্তা',
    intro:
      'টু-ফ্যাক্টর লগইন: পাসওয়ার্ডের পরে আপনার ফোনের অথেন্টিকেটর অ্যাপের ৬ অঙ্কের একটি কোড (যেমন Google Authenticator, Microsoft Authenticator বা 2FAS)।',
    required:
      'অ্যাডমিন আর ম্যানেজারদের অন্য কোনো অ্যাডমিন পেজ খোলার আগে টু-ফ্যাক্টর লগইন চালু করতে হবে।',
    unavailable: 'এই সার্ভারে টু-ফ্যাক্টর লগইন চালু নেই, তাই এখানে কিছু সেট আপ করার নেই।',
    on: 'চালু',
    off: 'বন্ধ',
    statusLabel: 'টু-ফ্যাক্টর লগইন',
    recoveryLeft: (n: string) => `অব্যবহৃত রিকভারি কোড: ${n}টি`,
    recoveryLow: 'রিকভারি কোড অল্প বাকি আছে। নিচে নতুন কোড বানিয়ে নিন।',
    password: 'আপনার পাসওয়ার্ড',
    code: 'অ্যাপের কোড',
    recoveryCode: 'রিকভারি কোড',
    useRecovery: 'বরং রিকভারি কোড ব্যবহার করুন',
    useApp: 'বরং অ্যাপের কোড ব্যবহার করুন',
    setup: {
      title: 'টু-ফ্যাক্টর লগইন চালু করুন',
      step1: 'ধাপ ১: আপনার পাসওয়ার্ড দিয়ে নিশ্চিত করুন।',
      start: 'সেটআপ শুরু করুন',
      step2: 'ধাপ ২: অথেন্টিকেটর অ্যাপ দিয়ে এই QR কোডটি স্ক্যান করুন।',
      qrAlt: 'অথেন্টিকেটর অ্যাপে Sirat যোগ করার QR কোড',
      manual: 'স্ক্যান করা যাচ্ছে না? অ্যাপে এই কী-টি হাতে লিখুন:',
      step3: 'ধাপ ৩: অ্যাপে এখন Sirat-এর যে ৬ অঙ্কের কোড দেখাচ্ছে, সেটি লিখুন।',
      enable: 'চালু করুন',
      startOver: 'আবার শুরু করুন',
    },
    codes: {
      title: 'আপনার রিকভারি কোড',
      text: 'ফোন হারালে এই কোডগুলোর প্রতিটি দিয়ে একবার লগইন করা যায়। এখনই এগুলো অফলাইনে রেখে দিন (প্রিন্ট করুন বা লিখে রাখুন): আর দেখানো হবে না।',
      copy: 'কোডগুলো কপি করুন',
      copied: 'কপি হয়েছে',
      done: 'আমি রেখে দিয়েছি',
    },
    renew: {
      title: 'নতুন রিকভারি কোড',
      text: '১০টি নতুন রিকভারি কোড বানায় আর পুরনো সবগুলো বাতিল করে। অ্যাপের একটি কোড দিয়ে নিশ্চিত করুন।',
      submit: 'নতুন কোড বানান',
    },
    disable: {
      title: 'টু-ফ্যাক্টর লগইন বন্ধ করুন',
      text: 'অ্যাডমিন আর ম্যানেজারদের অ্যাডমিন পেজ ব্যবহারের আগে আবার এটি সেট আপ করতে হবে। নতুন ফোনে যাওয়ার সময় এটি ব্যবহার করুন।',
      submit: 'বন্ধ করুন',
    },
    working: 'অপেক্ষা করুন…',
    invalidCode: 'অথেন্টিকেটর অ্যাপের ৬ অঙ্কের কোডটি লিখুন।',
    invalidRecovery: 'ABCDE-FGH23-এর মতো একটি রিকভারি কোড লিখুন।',
    problems: {
      wrongPassword: 'পাসওয়ার্ড সঠিক নয়।',
      wrongCode: 'কোডটি সঠিক নয়। ফোনের সময় স্বয়ংক্রিয়ভাবে ঠিক করা আছে কিনা দেখুন।',
      setupAgain: 'এই সেটআপের মেয়াদ শেষ। আবার শুরু করুন।',
      alreadyOn: 'টু-ফ্যাক্টর লগইন আগেই চালু আছে। পেজটি রিলোড করুন।',
      notOn: 'টু-ফ্যাক্টর লগইন চালু নেই। পেজটি রিলোড করুন।',
      tooMany: 'অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।',
      unavailable: 'এই সার্ভারে টু-ফ্যাক্টর লগইন চালু নেই।',
      failed: 'কাজটি হয়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    },
  },
});

export type AdminSecurityMessages = (typeof adminSecurityMessages)['en'];
