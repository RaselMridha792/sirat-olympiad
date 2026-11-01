import { defineMessages } from '../messages.ts';

/*
 * "Coming soon" for a dashboard page the launch table marks `soon` (data/launch.ts, LAUNCH-PLAN §8). Rasel checks
 * the Bangla (Q5).
 */
export const launchMessages = defineMessages({
  en: {
    title: 'Coming soon',
    message: 'This page opens soon. Everything else in your dashboard works as usual.',
  },
  bn: {
    title: 'শীঘ্রই আসছে',
    message: 'এই পাতাটি শীঘ্রই চালু হবে। ড্যাশবোর্ডের বাকি সবকিছু আগের মতোই কাজ করছে।',
  },
});
