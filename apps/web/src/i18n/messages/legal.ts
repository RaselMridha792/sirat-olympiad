import { defineMessages } from '../messages.ts';

/*
 * The public entry page and the legal pages (core plan section 3). PLACEHOLDER texts until the client sends the
 * final ones (core plan Q5); they state only what the system really does. The refund rule is the owner's (DECISIONS
 * "No refund handling"). Rendered as text by <Prose>, never as HTML.
 */
export const legalMessages = defineMessages({
  en: {
    nav: {
      label: 'Site',
      home: 'Home',
      about: 'About',
      privacy: 'Privacy policy',
      terms: 'Terms and conditions',
      refund: 'Refund policy',
      login: 'Log in',
      register: 'Register',
      otherLanguage: 'বাংলা',
      otherLanguageLabel: 'এই পাতা বাংলায় পড়ুন',
    },
    draftNote: 'Draft: this text is a placeholder until the organiser publishes the final version.',
    effective: (date: string) => `Effective from ${date}`,
    footer: {
      contact: 'Contact',
      contactMissing: 'Contact details will be published here soon.',
      email: 'Email',
      phone: 'Phone',
      address: 'Address',
      registeredName: 'Registered name',
      rights: (year: string, organiser: string) => `© ${year} ${organiser}`,
    },
    home: {
      title: 'Sirat Leadership Olympiad',
      tagline: 'An online leadership olympiad for students in Bangladesh.',
      intro:
        'Students register online, sit a timed exam from a phone or a computer, and see their results on their own dashboard. Categories follow the student’s class: Activist, Ambassador and Achiever.',
      stepsTitle: 'How it works',
      steps: [
        'Register and pay the fee online through PayStation (mobile banking, cards and more).',
        'Log in with the email and the password you chose when you registered.',
        'Sit the exam inside its window. It lasts at most 30 minutes, and the timer runs on our server.',
      ],
      fee: (amount: string) => `Registration fee: ${amount}`,
      feeUnknown: 'The registration fee is shown when you register.',
      open: 'Registration is open.',
      closed: 'Registration is not open right now.',
      metaDescription:
        'Register for the Sirat Leadership Olympiad, an online olympiad for students.',
    },
    about: {
      title: 'About the olympiad',
      metaDescription: 'Who runs the Sirat Leadership Olympiad and how it works.',
      sections: [
        {
          heading: 'What it is',
          paragraphs: [
            'The Sirat Leadership Olympiad is an online competition for school and college students, run as a partnership of GLTS Leadership and Sirat Olympiad.',
          ],
        },
        {
          heading: 'Categories',
          paragraphs: [
            'Each student competes in the category of their class: Activist, Ambassador or Achiever. The category is set from the class chosen at registration.',
          ],
        },
        {
          heading: 'Who runs it',
          paragraphs: [
            'The organiser’s registered name, address and contact details are listed at the bottom of every page.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      metaDescription:
        'What personal data the Sirat Leadership Olympiad collects and how it is used.',
      sections: [
        {
          heading: 'What we collect',
          paragraphs: [
            'When you register: your name, mobile number, email address, district, institution, type of education and class. Your password is stored only in a form that cannot be read back.',
            'When you pay: the invoice number, amount and status that PayStation reports. Card and mobile wallet details are entered on PayStation’s page and never reach us.',
            'When you take part: your exam answers and times, and security records such as sign-in attempts and the IP address they came from.',
          ],
        },
        {
          heading: 'Why we use it',
          paragraphs: [
            'To register you, confirm your payment, run the exams, publish results and certificates, write to you about the olympiad, and keep accounts safe.',
          ],
        },
        {
          heading: 'Who can see it',
          paragraphs: [
            'The organiser’s administrators. PayStation for your payment, and our email provider for the emails we send you. Other students see only your name and institution on the leaderboard, after the results are published. We do not sell personal data.',
          ],
        },
        {
          heading: 'Students under 18',
          paragraphs: [
            'Many participants are under 18. We collect only what the competition needs: no date of birth, no photo and no guardian details.',
          ],
        },
        {
          heading: 'Cookies',
          paragraphs: [
            'We use cookies only to keep you signed in, to let you continue a registration you started, and to remember your language. We use no advertising or tracking cookies.',
          ],
        },
        {
          heading: 'Your choices',
          paragraphs: [
            'You can see and correct your details on your dashboard. To ask what we hold about you, or to ask for it to be deleted, contact us using the details below.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms and conditions',
      metaDescription:
        'The rules for registering and taking part in the Sirat Leadership Olympiad.',
      sections: [
        {
          heading: 'Taking part',
          paragraphs: [
            'One account per student. An email address and a mobile number can belong to one student only.',
          ],
        },
        {
          heading: 'Registration and fee',
          paragraphs: [
            'The fee is shown when you register and is paid online through PayStation. Your registration is complete only after PayStation confirms the payment.',
          ],
        },
        {
          heading: 'The exam',
          paragraphs: [
            'Each exam has one attempt per student, inside the window the organiser sets. The timer runs on our server and keeps running if your connection drops; you can come back within the time left.',
            'Leaving the exam (another tab or app) counts as a warning. After five warnings, the sixth ends the exam and submits the answers given so far.',
          ],
        },
        {
          heading: 'Fair play',
          paragraphs: [
            'Answer on your own and do not share the questions. The organiser may block an account that breaks these rules.',
          ],
        },
        {
          heading: 'Results',
          paragraphs: [
            'Results are published after the exam window has closed for everyone. Students are ranked by score, and an equal score by the shorter time.',
          ],
        },
        {
          heading: 'Changes',
          paragraphs: [
            'The organiser may change dates or rules. Changes are announced on the student dashboard.',
          ],
        },
      ],
    },
    refund: {
      title: 'Refund policy',
      metaDescription: 'The refund policy for the Sirat Leadership Olympiad registration fee.',
      sections: [
        {
          heading: 'Registration fee',
          paragraphs: ['The registration fee is non-refundable.'],
        },
        {
          heading: 'If something went wrong with a payment',
          paragraphs: [
            'Your registration is confirmed only after PayStation confirms the payment. If money was taken but you did not get a confirmation, do not pay again: contact us with your invoice number.',
            'If you were charged twice for one registration, contact us with both invoice numbers.',
          ],
        },
      ],
    },
  },
  bn: {
    nav: {
      label: 'সাইট',
      home: 'প্রথম পাতা',
      about: 'পরিচিতি',
      privacy: 'গোপনীয়তা নীতি',
      terms: 'শর্তাবলি',
      refund: 'ফেরত নীতি',
      login: 'লগইন',
      register: 'রেজিস্ট্রেশন',
      otherLanguage: 'English',
      otherLanguageLabel: 'Read this page in English',
    },
    draftNote: 'খসড়া: আয়োজক চূড়ান্ত লেখা প্রকাশ না করা পর্যন্ত এটি একটি অস্থায়ী লেখা।',
    effective: (date: string) => `কার্যকর: ${date} থেকে`,
    footer: {
      contact: 'যোগাযোগ',
      contactMissing: 'যোগাযোগের তথ্য শিগগিরই এখানে দেওয়া হবে।',
      email: 'ইমেইল',
      phone: 'ফোন',
      address: 'ঠিকানা',
      registeredName: 'নিবন্ধিত নাম',
      rights: (year: string, organiser: string) => `© ${year} ${organiser}`,
    },
    home: {
      title: 'সিরাত লিডারশিপ অলিম্পিয়াড',
      tagline: 'বাংলাদেশের শিক্ষার্থীদের জন্য একটি অনলাইন লিডারশিপ অলিম্পিয়াড।',
      intro:
        'শিক্ষার্থীরা অনলাইনে রেজিস্ট্রেশন করে, ফোন বা কম্পিউটার থেকে নির্দিষ্ট সময়ের পরীক্ষা দেয়, আর নিজের ড্যাশবোর্ডে ফল দেখে। ক্যাটাগরি শিক্ষার্থীর শ্রেণি অনুযায়ী: অ্যাক্টিভিস্ট, অ্যাম্বাসেডর আর অ্যাচিভার।',
      stepsTitle: 'কীভাবে অংশ নেবেন',
      steps: [
        'রেজিস্ট্রেশন করুন আর PayStation-এর মাধ্যমে অনলাইনে ফি দিন (মোবাইল ব্যাংকিং, কার্ড ইত্যাদি)।',
        'রেজিস্ট্রেশনের সময় দেওয়া ইমেইল আর পাসওয়ার্ড দিয়ে লগইন করুন।',
        'নির্ধারিত সময়ের মধ্যে পরীক্ষা দিন। পরীক্ষা সর্বোচ্চ ৩০ মিনিটের, আর সময় চলে আমাদের সার্ভারে।',
      ],
      fee: (amount: string) => `রেজিস্ট্রেশন ফি: ${amount}`,
      feeUnknown: 'রেজিস্ট্রেশনের সময় ফি দেখানো হবে।',
      open: 'রেজিস্ট্রেশন চলছে।',
      closed: 'এখন রেজিস্ট্রেশন বন্ধ।',
      metaDescription:
        'সিরাত লিডারশিপ অলিম্পিয়াডে রেজিস্ট্রেশন করুন, শিক্ষার্থীদের জন্য একটি অনলাইন অলিম্পিয়াড।',
    },
    about: {
      title: 'অলিম্পিয়াড পরিচিতি',
      metaDescription: 'সিরাত লিডারশিপ অলিম্পিয়াড কারা আয়োজন করে আর কীভাবে চলে।',
      sections: [
        {
          heading: 'এটি কী',
          paragraphs: [
            'সিরাত লিডারশিপ অলিম্পিয়াড স্কুল আর কলেজের শিক্ষার্থীদের জন্য একটি অনলাইন প্রতিযোগিতা, GLTS Leadership আর Sirat Olympiad-এর যৌথ আয়োজন।',
          ],
        },
        {
          heading: 'ক্যাটাগরি',
          paragraphs: [
            'প্রত্যেক শিক্ষার্থী নিজের শ্রেণির ক্যাটাগরিতে প্রতিযোগিতা করে: অ্যাক্টিভিস্ট, অ্যাম্বাসেডর বা অ্যাচিভার। রেজিস্ট্রেশনে বেছে নেওয়া শ্রেণি থেকে ক্যাটাগরি ঠিক হয়।',
          ],
        },
        {
          heading: 'আয়োজক',
          paragraphs: [
            'আয়োজকের নিবন্ধিত নাম, ঠিকানা আর যোগাযোগের তথ্য প্রতিটি পাতার নিচে দেওয়া আছে।',
          ],
        },
      ],
    },
    privacy: {
      title: 'গোপনীয়তা নীতি',
      metaDescription: 'সিরাত লিডারশিপ অলিম্পিয়াড কোন ব্যক্তিগত তথ্য নেয় আর কীভাবে ব্যবহার করে।',
      sections: [
        {
          heading: 'আমরা কী তথ্য নিই',
          paragraphs: [
            'রেজিস্ট্রেশনের সময়: আপনার নাম, মোবাইল নম্বর, ইমেইল, জেলা, শিক্ষাপ্রতিষ্ঠান, শিক্ষার ধরন আর শ্রেণি। আপনার পাসওয়ার্ড এমনভাবে রাখা হয় যা আর পড়া যায় না।',
            'পেমেন্টের সময়: PayStation যে ইনভয়েস নম্বর, পরিমাণ আর অবস্থা জানায়। কার্ড বা মোবাইল ওয়ালেটের তথ্য PayStation-এর পাতায় দেওয়া হয়, তা আমাদের কাছে আসে না।',
            'অংশ নেওয়ার সময়: আপনার পরীক্ষার উত্তর আর সময়, আর নিরাপত্তার রেকর্ড, যেমন লগইনের চেষ্টা আর সেগুলোর IP ঠিকানা।',
          ],
        },
        {
          heading: 'কেন ব্যবহার করি',
          paragraphs: [
            'আপনার রেজিস্ট্রেশন, পেমেন্ট নিশ্চিত করা, পরীক্ষা চালানো, ফল আর সার্টিফিকেট প্রকাশ, অলিম্পিয়াড নিয়ে আপনাকে লেখা, আর অ্যাকাউন্ট নিরাপদ রাখার জন্য।',
          ],
        },
        {
          heading: 'কারা দেখতে পায়',
          paragraphs: [
            'আয়োজকের অ্যাডমিনরা। পেমেন্টের জন্য PayStation, আর আমাদের পাঠানো ইমেইলের জন্য ইমেইল সেবাদাতা। ফল প্রকাশের পরে অন্য শিক্ষার্থীরা লিডারবোর্ডে শুধু আপনার নাম আর শিক্ষাপ্রতিষ্ঠান দেখে। আমরা কারো ব্যক্তিগত তথ্য বিক্রি করি না।',
          ],
        },
        {
          heading: '১৮ বছরের কম বয়সী শিক্ষার্থী',
          paragraphs: [
            'অনেক অংশগ্রহণকারীর বয়স ১৮-র কম। প্রতিযোগিতার জন্য যা দরকার, আমরা শুধু তা-ই নিই: জন্মতারিখ, ছবি বা অভিভাবকের তথ্য নিই না।',
          ],
        },
        {
          heading: 'কুকি',
          paragraphs: [
            'কুকি ব্যবহার করি শুধু লগইন রাখতে, শুরু করা রেজিস্ট্রেশন আবার চালিয়ে যেতে, আর ভাষা মনে রাখতে। বিজ্ঞাপন বা ট্র্যাকিংয়ের কোনো কুকি নেই।',
          ],
        },
        {
          heading: 'আপনার অধিকার',
          paragraphs: [
            'ড্যাশবোর্ডে আপনার তথ্য দেখতে আর ঠিক করতে পারবেন। আপনার কী তথ্য আমাদের কাছে আছে জানতে, বা তা মুছে ফেলতে চাইলে নিচের ঠিকানায় যোগাযোগ করুন।',
          ],
        },
      ],
    },
    terms: {
      title: 'শর্তাবলি',
      metaDescription: 'সিরাত লিডারশিপ অলিম্পিয়াডে রেজিস্ট্রেশন আর অংশগ্রহণের নিয়ম।',
      sections: [
        {
          heading: 'অংশগ্রহণ',
          paragraphs: [
            'প্রত্যেক শিক্ষার্থীর একটি অ্যাকাউন্ট। একটি ইমেইল আর একটি মোবাইল নম্বর শুধু একজন শিক্ষার্থীর হতে পারে।',
          ],
        },
        {
          heading: 'রেজিস্ট্রেশন আর ফি',
          paragraphs: [
            'রেজিস্ট্রেশনের সময় ফি দেখানো হয়, আর PayStation-এর মাধ্যমে অনলাইনে দিতে হয়। PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন সম্পূর্ণ হয়।',
          ],
        },
        {
          heading: 'পরীক্ষা',
          paragraphs: [
            'আয়োজকের ঠিক করা সময়ের মধ্যে প্রতিটি পরীক্ষা একজন শিক্ষার্থী একবারই দিতে পারে। সময় চলে আমাদের সার্ভারে, ইন্টারনেট চলে গেলেও সময় চলতে থাকে; বাকি সময়ের মধ্যে আবার ফিরে আসা যায়।',
            'পরীক্ষা ছেড়ে অন্য ট্যাব বা অ্যাপে গেলে একটি সতর্কতা গোনা হয়। পাঁচটি সতর্কতার পরে ষষ্ঠবারে পরীক্ষা শেষ হয়ে যায়, আর তখন পর্যন্ত দেওয়া উত্তর জমা হয়।',
          ],
        },
        {
          heading: 'সৎভাবে অংশ নেওয়া',
          paragraphs: [
            'নিজে উত্তর দিন, প্রশ্ন কারো সাথে শেয়ার করবেন না। এই নিয়ম ভাঙলে আয়োজক অ্যাকাউন্ট বন্ধ করতে পারেন।',
          ],
        },
        {
          heading: 'ফলাফল',
          paragraphs: [
            'সবার জন্য পরীক্ষার সময় শেষ হওয়ার পরে ফল প্রকাশ হয়। নম্বর অনুযায়ী ক্রম ঠিক হয়, আর সমান নম্বরে কম সময় লাগা শিক্ষার্থী আগে থাকে।',
          ],
        },
        {
          heading: 'পরিবর্তন',
          paragraphs: [
            'আয়োজক তারিখ বা নিয়ম বদলাতে পারেন। পরিবর্তন শিক্ষার্থীর ড্যাশবোর্ডে জানানো হয়।',
          ],
        },
      ],
    },
    refund: {
      title: 'ফেরত নীতি',
      metaDescription: 'সিরাত লিডারশিপ অলিম্পিয়াডের রেজিস্ট্রেশন ফি ফেরতের নীতি।',
      sections: [
        {
          heading: 'রেজিস্ট্রেশন ফি',
          paragraphs: ['রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়।'],
        },
        {
          heading: 'পেমেন্টে সমস্যা হলে',
          paragraphs: [
            'PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন নিশ্চিত হয়। টাকা কেটে নেওয়া হয়েছে অথচ নিশ্চিতকরণ পাননি, এমন হলে আবার পেমেন্ট করবেন না: ইনভয়েস নম্বরসহ আমাদের সাথে যোগাযোগ করুন।',
            'একটি রেজিস্ট্রেশনের জন্য দুবার টাকা কেটে থাকলে দুটো ইনভয়েস নম্বরসহ যোগাযোগ করুন।',
          ],
        },
      ],
    },
  },
});

export type LegalMessages = (typeof legalMessages)['en'];
