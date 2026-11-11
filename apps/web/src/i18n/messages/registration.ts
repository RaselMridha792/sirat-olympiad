import { REGISTRATION_MESSAGES } from '@sirat/shared';
import { defineMessages } from '../messages.ts';

/*
 * Registration and payment (payments PR 4): the wizard on /register and the result page PayStation sends the student
 * back to (/register/result). The dashboard's registration card is core's (C4); its state labels are in
 * @sirat/shared (REGISTRATION_STATE_LABELS). The client components import this
 * module and pick the language themselves (the page passes only the locale). The owner's texts for an email or a
 * phone already registered, and for paused payments, come from @sirat/shared (REGISTRATION_MESSAGES), word for word.
 */
const owner = (code: 'EMAIL_REGISTERED' | 'PHONE_REGISTERED' | 'PAYMENTS_PAUSED') => {
  const text = REGISTRATION_MESSAGES[code];
  if (!text) throw new Error(`missing owner text ${code}`);
  return text;
};

export const registrationMessages = defineMessages({
  en: {
    metaTitle: 'Register',
    title: 'Register for the Olympiad',
    fee: (amount: string) =>
      `Registration fee: ৳${amount}. You pay on PayStation's secure page; your account is created as soon as the payment is confirmed.`,
    step: (n: string, total: string) => `Step ${n} of ${total}`,
    steps: { you: 'About you', school: 'Your school', review: 'Check and pay' },
    fields: {
      name: 'Full name',
      phone: 'Mobile number',
      phoneHint: 'A Bangladeshi mobile number, e.g. 01712345678.',
      email: 'Email',
      emailHint: 'You log in with it, and we write to it.',
      password: 'Password',
      passwordHint: '8 to 128 characters. You log in with it after paying.',
      district: 'District',
      choose: 'Choose…',
      institution: 'School, college or university',
      educationType: 'Education type',
      grade: 'Class',
      promoCode: 'Promo code (optional)',
      promoHint: "An ambassador's code, if you have one.",
    },
    next: 'Next',
    back: 'Back',
    edit: 'Change',
    pay: (amount: string) => `Pay ৳${amount}`,
    paying: 'Opening PayStation…',
    reviewNote:
      'Check your details. Your account is created with them once the payment is confirmed.',
    haveAccount: 'Already registered?',
    login: 'Log in',
    invalid: {
      required: 'Fill this in.',
      choose: 'Choose one.',
      name: 'Enter your name (2 to 100 characters).',
      phone: 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
      email: 'Enter a valid email address.',
      passwordShort: 'The password must be at least 8 characters.',
      passwordLong: 'The password must be at most 128 characters.',
      passwordCommon: 'This password is too common. Choose another one.',
      institution: 'Enter your institution (2 to 150 characters).',
      promoCode: 'A promo code has 3 to 40 letters, digits, "-" or "_".',
    },
    errors: {
      REGISTRATION_CLOSED: 'Registration is closed right now.',
      PAYMENTS_UNAVAILABLE: 'Payments are not available right now. Please try again later.',
      PAYMENTS_PAUSED: owner('PAYMENTS_PAUSED').en,
      EMAIL_REGISTERED: owner('EMAIL_REGISTERED').en,
      EMAIL_IN_PROGRESS:
        'A payment for this email is already in progress. Continue in the browser where you started, or try again a little later, once it has expired.',
      PHONE_REGISTERED: owner('PHONE_REGISTERED').en,
      PROMO_INVALID: 'This promo code is not valid. Check it, or leave the field empty.',
      PROMO_USED_UP:
        'This code has reached its limit. Start again without it or with another code.',
      GRADE_LEVEL_UNKNOWN: 'Choose your class again.',
      START_IN_PROGRESS: 'Your payment is being prepared. Try again in a moment.',
      START_REQUEST_REUSED: 'Please press the button again.',
      START_OVER: 'This registration has expired. Please fill in the form again.',
      PAYMENT_START_FAILED: 'The payment could not start. Please try again.',
      TOO_MANY_ATTEMPTS: 'Too many attempts with this email or phone. Try again in an hour.',
      invalid: 'Some details are not accepted. Check the form.',
      busy: 'The server is busy. Try again in a moment.',
      network: 'Could not reach the server. Check your connection and try again.',
    },
    closed: {
      title: 'Registration is closed',
      text: 'Registration is not open right now. Please check back later.',
      opensAt: (date: string) => `Registration opens on ${date}.`,
    },
    unavailable: {
      title: 'Registration is not available',
      text: 'We cannot load the registration form right now. Please try again in a few minutes.',
    },
    previous: {
      resume: 'You have a payment in progress in this browser.',
      continue: 'Continue the payment',
      retry: 'Your last payment did not go through. Your details are saved.',
      tryAgain: 'Try again',
      confirming: 'We are confirming your payment.',
      status: 'See the status',
      completed: 'This browser has already completed a registration.',
      startOver: 'Start over',
    },
    result: {
      metaTitle: 'Payment status',
      checking: 'Checking your payment…',
      invoice: 'Invoice',
      amount: 'Amount',
      awaiting_payment: {
        title: 'Waiting for your payment',
        text: 'If you closed the payment page, you can continue it.',
      },
      confirming: {
        title: 'Confirming your payment',
        text: 'We are confirming the payment with PayStation. This usually takes a few seconds.',
      },
      completed: {
        title: 'Registration complete',
        text: 'Your account is ready. Log in with the email and password you chose. We have also sent you a link to verify your email.',
      },
      failed: {
        title: 'The payment did not go through',
        text: 'PayStation reported that the payment was not completed, so no account was created. Your details are saved: you can try again.',
      },
      expired: {
        title: 'The payment time ran out',
        text: 'The checkout was not completed in time. Your details are saved: you can try again.',
      },
      needs_help: {
        title: 'We need to check your payment',
        text: 'Your payment was received, but your registration could not be finished automatically. Our team will contact you. Keep your invoice number.',
      },
      none: {
        title: 'No registration in this browser',
        text: 'Start a registration here, or log in if you already have an account.',
      },
      error: {
        title: 'We could not check your payment',
        text: 'Your connection or our server is having trouble. Try again in a moment.',
      },
      noRetry: 'A new payment cannot start right now.',
      stillWaiting: 'Still confirming? Ask PayStation again.',
      recheck: 'Check my payment status',
      rechecked: 'We asked PayStation again. This page updates by itself.',
      continue: 'Continue the payment',
      tryAgain: 'Try again',
      startOver: 'Start over',
      register: 'Register',
      login: 'Log in',
      loginForBook: 'Log in to get your free book',
      participantIdTitle: 'Your participant ID',
      participantIdCopy: 'Copy the ID',
      participantIdCopied: 'Copied',
      participantIdCopyFailed: 'Could not copy. Select the ID and copy it yourself.',
      participantIdNote:
        'We also emailed it to you. It is on your admit card, and you sign in with it together with your email. Keep it private.',
      retryLoad: 'Try again',
    },
  },
  bn: {
    metaTitle: 'রেজিস্ট্রেশন',
    title: 'অলিম্পিয়াডে রেজিস্ট্রেশন',
    fee: (amount: string) =>
      `রেজিস্ট্রেশন ফি: ৳${amount}। পেমেন্ট হবে PayStation-এর নিরাপদ পেজে; পেমেন্ট নিশ্চিত হলেই আপনার অ্যাকাউন্ট তৈরি হবে।`,
    step: (n: string, total: string) => `ধাপ ${n} / ${total}`,
    steps: { you: 'আপনার তথ্য', school: 'আপনার শিক্ষা প্রতিষ্ঠান', review: 'যাচাই ও পেমেন্ট' },
    fields: {
      name: 'পুরো নাম',
      phone: 'মোবাইল নম্বর',
      phoneHint: 'বাংলাদেশি মোবাইল নম্বর, যেমন 01712345678।',
      email: 'Email',
      emailHint: 'এটি দিয়ে login করবেন, আর আমরা এখানেই লিখব।',
      password: 'পাসওয়ার্ড',
      passwordHint: '৮ থেকে ১২৮ অক্ষর। পেমেন্টের পর এটি দিয়ে login করবেন।',
      district: 'জেলা',
      choose: 'বেছে নিন…',
      institution: 'স্কুল, কলেজ বা বিশ্ববিদ্যালয়',
      educationType: 'শিক্ষার ধরন',
      grade: 'শ্রেণি',
      promoCode: 'প্রোমো কোড (ঐচ্ছিক)',
      promoHint: 'কোনো অ্যাম্বাসেডরের কোড থাকলে দিন।',
    },
    next: 'পরের ধাপ',
    back: 'আগের ধাপ',
    edit: 'বদলান',
    pay: (amount: string) => `৳${amount} পেমেন্ট করুন`,
    paying: 'PayStation খোলা হচ্ছে…',
    reviewNote:
      'তথ্যগুলো মিলিয়ে নিন। পেমেন্ট নিশ্চিত হলে এই তথ্য দিয়েই আপনার অ্যাকাউন্ট তৈরি হবে।',
    haveAccount: 'আগেই রেজিস্ট্রেশন করেছেন?',
    login: 'Login করুন',
    invalid: {
      required: 'এটি পূরণ করুন।',
      choose: 'একটি বেছে নিন।',
      name: 'আপনার নাম লিখুন (২ থেকে ১০০ অক্ষর)।',
      phone: 'বাংলাদেশি মোবাইল নম্বর দিন, যেমন 01712345678।',
      email: 'সঠিক email ঠিকানা দিন।',
      passwordShort: 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।',
      passwordLong: 'পাসওয়ার্ড ১২৮ অক্ষরের বেশি হতে পারবে না।',
      passwordCommon: 'এই পাসওয়ার্ডটি খুব প্রচলিত। অন্য একটি বেছে নিন।',
      institution: 'আপনার শিক্ষা প্রতিষ্ঠানের নাম লিখুন (২ থেকে ১৫০ অক্ষর)।',
      promoCode: 'প্রোমো কোডে ৩ থেকে ৪০টি অক্ষর, সংখ্যা, "-" বা "_" থাকে।',
    },
    errors: {
      REGISTRATION_CLOSED: 'রেজিস্ট্রেশন এখন বন্ধ।',
      PAYMENTS_UNAVAILABLE: 'পেমেন্ট এখন করা যাচ্ছে না। পরে আবার চেষ্টা করুন।',
      PAYMENTS_PAUSED: owner('PAYMENTS_PAUSED').bn,
      EMAIL_REGISTERED: owner('EMAIL_REGISTERED').bn,
      EMAIL_IN_PROGRESS:
        'এই email-এর একটি পেমেন্ট এখন চলছে। যে ব্রাউজারে শুরু করেছিলেন সেখানে চালিয়ে যান, অথবা কিছুক্ষণ পরে, সময় শেষ হলে আবার চেষ্টা করুন।',
      PHONE_REGISTERED: owner('PHONE_REGISTERED').bn,
      PROMO_INVALID: 'এই প্রোমো কোডটি সঠিক নয়। মিলিয়ে দেখুন, অথবা ঘরটি খালি রাখুন।',
      PROMO_USED_UP:
        'এই কোডটির ব্যবহারের সীমা শেষ হয়ে গেছে। কোড ছাড়া বা অন্য কোড দিয়ে আবার শুরু করুন।',
      GRADE_LEVEL_UNKNOWN: 'আপনার শ্রেণি আবার বেছে নিন।',
      START_IN_PROGRESS: 'আপনার পেমেন্ট প্রস্তুত হচ্ছে। একটু পরে আবার চেষ্টা করুন।',
      START_REQUEST_REUSED: 'অনুগ্রহ করে বোতামটি আবার চাপুন।',
      START_OVER: 'এই রেজিস্ট্রেশনের মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে ফর্মটি আবার পূরণ করুন।',
      PAYMENT_START_FAILED: 'পেমেন্ট শুরু করা গেল না। আবার চেষ্টা করুন।',
      TOO_MANY_ATTEMPTS:
        'এই email বা ফোন দিয়ে অনেকবার চেষ্টা হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।',
      invalid: 'কিছু তথ্য গ্রহণ করা যায়নি। ফর্মটি মিলিয়ে দেখুন।',
      busy: 'সার্ভার এখন ব্যস্ত। একটু পরে আবার চেষ্টা করুন।',
      network: 'সার্ভারে পৌঁছানো গেল না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    },
    closed: {
      title: 'রেজিস্ট্রেশন বন্ধ',
      text: 'রেজিস্ট্রেশন এখন খোলা নেই। পরে আবার দেখুন।',
      opensAt: (date: string) => `রেজিস্ট্রেশন খুলবে ${date}।`,
    },
    unavailable: {
      title: 'রেজিস্ট্রেশন এখন পাওয়া যাচ্ছে না',
      text: 'রেজিস্ট্রেশন ফর্মটি এখন লোড করা যাচ্ছে না। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
    },
    previous: {
      resume: 'এই ব্রাউজারে আপনার একটি পেমেন্ট চলছে।',
      continue: 'পেমেন্ট চালিয়ে যান',
      retry: 'আপনার শেষ পেমেন্টটি সম্পন্ন হয়নি। আপনার তথ্য সংরক্ষিত আছে।',
      tryAgain: 'আবার চেষ্টা করুন',
      confirming: 'আমরা আপনার পেমেন্ট নিশ্চিত করছি।',
      status: 'অবস্থা দেখুন',
      completed: 'এই ব্রাউজারে একটি রেজিস্ট্রেশন আগেই সম্পন্ন হয়েছে।',
      startOver: 'নতুন করে শুরু করুন',
    },
    result: {
      metaTitle: 'পেমেন্টের অবস্থা',
      checking: 'আপনার পেমেন্ট দেখা হচ্ছে…',
      invoice: 'ইনভয়েস',
      amount: 'পরিমাণ',
      awaiting_payment: {
        title: 'আপনার পেমেন্টের অপেক্ষায়',
        text: 'পেমেন্ট পেজ বন্ধ করে থাকলে আবার চালিয়ে যেতে পারেন।',
      },
      confirming: {
        title: 'আপনার পেমেন্ট নিশ্চিত করা হচ্ছে',
        text: 'আমরা PayStation-এর সাথে পেমেন্টটি নিশ্চিত করছি। সাধারণত কয়েক সেকেন্ড লাগে।',
      },
      completed: {
        title: 'রেজিস্ট্রেশন সম্পন্ন',
        text: 'আপনার অ্যাকাউন্ট তৈরি হয়েছে। যে email ও পাসওয়ার্ড দিয়েছেন তা দিয়ে login করুন। email যাচাই করার একটি লিংকও আপনাকে পাঠানো হয়েছে।',
      },
      failed: {
        title: 'পেমেন্ট সম্পন্ন হয়নি',
        text: 'PayStation জানিয়েছে পেমেন্টটি সম্পন্ন হয়নি, তাই অ্যাকাউন্ট তৈরি হয়নি। আপনার তথ্য সংরক্ষিত আছে: আবার চেষ্টা করতে পারেন।',
      },
      expired: {
        title: 'পেমেন্টের সময় শেষ',
        text: 'নির্ধারিত সময়ের মধ্যে পেমেন্ট সম্পন্ন হয়নি। আপনার তথ্য সংরক্ষিত আছে: আবার চেষ্টা করতে পারেন।',
      },
      needs_help: {
        title: 'আপনার পেমেন্টটি আমাদের দেখতে হবে',
        text: 'আপনার পেমেন্ট পাওয়া গেছে, কিন্তু রেজিস্ট্রেশন স্বয়ংক্রিয়ভাবে সম্পন্ন করা যায়নি। আমাদের টিম আপনার সাথে যোগাযোগ করবে। ইনভয়েস নম্বরটি রেখে দিন।',
      },
      none: {
        title: 'এই ব্রাউজারে কোনো রেজিস্ট্রেশন নেই',
        text: 'এখানে রেজিস্ট্রেশন শুরু করুন, অথবা অ্যাকাউন্ট থাকলে login করুন।',
      },
      error: {
        title: 'পেমেন্টের অবস্থা দেখা গেল না',
        text: 'আপনার সংযোগে বা আমাদের সার্ভারে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন।',
      },
      noRetry: 'এখন নতুন পেমেন্ট শুরু করা যাচ্ছে না।',
      stillWaiting: 'এখনো নিশ্চিত হয়নি? PayStation-কে আবার জিজ্ঞেস করুন।',
      recheck: 'আমার পেমেন্টের অবস্থা দেখুন',
      rechecked: 'PayStation-কে আবার জিজ্ঞেস করা হয়েছে। এই পেজটি নিজেই আপডেট হবে।',
      continue: 'পেমেন্ট চালিয়ে যান',
      tryAgain: 'আবার চেষ্টা করুন',
      startOver: 'নতুন করে শুরু করুন',
      register: 'রেজিস্ট্রেশন করুন',
      login: 'Login করুন',
      loginForBook: 'Login করে আপনার ফ্রি বই নিন',
      participantIdTitle: 'আপনার পার্টিসিপেন্ট আইডি',
      participantIdCopy: 'আইডি কপি করুন',
      participantIdCopied: 'কপি হয়েছে',
      participantIdCopyFailed: 'কপি করা যায়নি। আইডিটি সিলেক্ট করে নিজে কপি করুন।',
      participantIdNote:
        'আইডিটি আপনার ইমেইলেও পাঠানো হয়েছে। এটি আপনার প্রবেশপত্রে থাকবে, আর ইমেইলের সঙ্গে এটি দিয়ে লগইন করবেন। আইডিটি গোপন রাখুন।',
      retryLoad: 'আবার চেষ্টা করুন',
    },
  },
});

export type RegistrationMessages = (typeof registrationMessages)['en'];
