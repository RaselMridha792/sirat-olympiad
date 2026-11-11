import { defineMessages } from '../messages.ts';

/** "Issue a new participant ID" in the student's detail dialog on /admin/users (payments P1b). */
export const adminParticipantIdMessages = defineMessages({
  en: {
    button: 'Issue a new participant ID',
    title: 'Issue a new participant ID',
    intro:
      'Use this when the ID has leaked, for example a posted admit card. The old ID stops working at once, the student is signed out everywhere, and the new ID is emailed to the student only. Nobody here sees it. Your reason is kept in the audit log.',
    reason: 'Reason',
    submit: 'Issue the new ID',
    pending: 'Issuing…',
    cancel: 'Cancel',
    done: (sessions: number) =>
      `A new ID was issued and emailed. ${sessions === 1 ? '1 session was' : `${sessions} sessions were`} ended.`,
    doneNoEmail:
      'A new ID was issued, but the email could not be queued. The student can ask for it with “forgot ID”.',
    errors: {
      reason: 'Write a reason of 10 to 200 characters.',
      notFound: 'This account has no registration, so it has no participant ID.',
      failed: 'The ID was not changed. Try again.',
    },
  },
  bn: {
    button: 'নতুন পার্টিসিপেন্ট আইডি দিন',
    title: 'নতুন পার্টিসিপেন্ট আইডি দিন',
    intro:
      'আইডি ফাঁস হলে এটা ব্যবহার করুন, যেমন কেউ প্রবেশপত্রের ছবি পোস্ট করলে। আগের আইডি সঙ্গে সঙ্গে বন্ধ হবে, শিক্ষার্থীকে সব ডিভাইস থেকে লগআউট করা হবে, আর নতুন আইডি শুধু শিক্ষার্থীর ইমেইলে যাবে। এখানে কেউ সেটি দেখবে না। আপনার কারণটি অডিট লগে থাকবে।',
    reason: 'কারণ',
    submit: 'নতুন আইডি দিন',
    pending: 'দেওয়া হচ্ছে…',
    cancel: 'বাতিল',
    done: (sessions: number) =>
      `নতুন আইডি দেওয়া হয়েছে আর ইমেইলে পাঠানো হয়েছে। ${sessions}টি সেশন বন্ধ করা হয়েছে।`,
    doneNoEmail:
      'নতুন আইডি দেওয়া হয়েছে, কিন্তু ইমেইল পাঠানো যায়নি। শিক্ষার্থী “আইডি ভুলে গেছি” দিয়ে আইডি চাইতে পারবে।',
    errors: {
      reason: '১০ থেকে ২০০ অক্ষরের মধ্যে একটি কারণ লিখুন।',
      notFound: 'এই অ্যাকাউন্টের কোনো রেজিস্ট্রেশন নেই, তাই কোনো পার্টিসিপেন্ট আইডিও নেই।',
      failed: 'আইডি বদলানো যায়নি। আবার চেষ্টা করুন।',
    },
  },
});
