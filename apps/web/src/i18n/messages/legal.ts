import { defineMessages } from '../messages.ts';

/*
 * The public entry page and the legal pages (core plan section 3). The privacy, terms and refund texts are our own
 * draft: the client sent none, so every statement was checked against the system on main (05-DATABASE, DECISIONS:
 * cookies, retention, the D6 scrub, A2.1b #9, admin 2FA, "No refund handling"; RUNBOOK section 11). The client
 * reviews them before launch; until then `site.placeholder` keeps the draft note and `noindex`. A change to the
 * system (data, cookies, retention, the refund rule) changes these texts in the same PR. Other pages are named in the
 * text, never linked by path. Rendered as text by <Prose>, never as HTML.
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
        'What personal information the Sirat Leadership Olympiad collects, why, who can see it and how long it is kept.',
      sections: [
        {
          heading: 'About this policy',
          paragraphs: [
            'The Sirat Leadership Olympiad is run by the organiser named at the bottom of this page. This policy explains what we collect through this website, why we collect it, who can see it and how long we keep it. We have written it to match how the website really works.',
          ],
        },
        {
          heading: 'What we collect',
          paragraphs: [
            'When you register: your name, mobile number, email address, district, institution, type of education and class, and the promo code of an ambassador if you used one. Your password is stored only in a scrambled form that cannot be turned back into the password.',
            'When you pay: PayStation tells us the invoice number, the amount, whether the payment went through, and its transaction reference. You enter card or mobile wallet details on PayStation’s own page, and they never reach us.',
            'When you take an exam: your answers, when you started and submitted, your score and the time you took. The exam page also records when you leave it for another tab or app, when developer tools are opened, and when your connection drops and comes back.',
            'In a video round: the link to the video you send.',
            'To keep accounts safe: records of sign-ins, including the IP address and the browser they came from, and a record of what the organiser’s staff do in the admin area.',
          ],
        },
        {
          heading: 'Why we use it',
          paragraphs: [
            'To register you and confirm your payment, let you sign in, run the exams fairly, work out and publish results, move students between rounds, issue certificates, and keep the website and your account secure.',
            'We email you only to confirm your email address and when you ask to reset your password. We do not use your information for advertising, and we never sell it.',
          ],
        },
        {
          heading: 'Who can see it',
          paragraphs: [
            'Other students: after the results of an exam are published, signed-in participants can see its leaderboard, which shows each student’s rank, name and institution only. Your score, time, mobile number and email are never shown to other students.',
            'You: after the results are published, you can see your own score, your answers and the correct answers on your dashboard.',
            'Judges in a video round see an entry number, the category and your video link, never your name or contact details.',
            'Ambassadors: an ambassador whose promo code you used sees only how many students used it, not who they are. If you join an ambassador team, the other members see only your first name.',
            'Certificates: anyone you give your certificate code to can check it. The check shows only your name and the award.',
            'The organiser’s staff: administrators can see registration details, payments and exam records so that they can run the olympiad; managers can see the full leaderboard with emails and scores. Administrators sign in with a password and a code from an authenticator app, and their actions are recorded.',
            'Service providers that handle data for us: PayStation (payments), Amazon Web Services’ email service (the emails we send you) and Hostinger (the server this website runs on).',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'Your account, your exam answers and results, and your payment records are kept; they are not deleted automatically. You can ask us to delete your account (see “Your rights” below).',
            'A registration you started but did not finish: the form, with your password, is deleted 30 days after your last step. When a registration is completed, that copy of the form is deleted at once.',
            'Sign-in sessions are deleted 30 days after they end, and the links we email you are deleted 7 days after they expire.',
            'Encrypted backup copies of the database are kept outside the server; the oldest is about five weeks old.',
          ],
        },
        {
          heading: 'Students under 18',
          paragraphs: [
            'Many participants are under 18. If you are under 18, please register with the knowledge and consent of a parent or guardian. A parent or guardian can write to us at any time to see, correct or delete their child’s information.',
            'We collect only what the olympiad needs: no date of birth, no photo and no details about parents or guardians.',
          ],
        },
        {
          heading: 'Cookies',
          paragraphs: [
            'We use only the cookies the website needs: to keep you signed in, for the second sign-in step of an administrator, to let you continue a registration you started, and to remember your language. There are no advertising, analytics or tracking cookies, and no tracking tools from other companies.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You can see your details and correct your name, mobile number, district, institution and type of education in your dashboard profile. To correct your email address or your class, write to us; your class can be corrected only before your first exam.',
            'You can ask us what information we hold about you, or ask us to delete your account. When we delete an account, we close it and remove what we can. We keep payment records, submitted exams and results, and security records, because we need them to answer payment questions, keep results fair and keep the website safe.',
            'Use the contact details at the bottom of this page.',
          ],
        },
        {
          heading: 'Changes to this policy',
          paragraphs: [
            'Last updated: 3 November 2026. If we change this policy, we will publish the new version on this page.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms and conditions',
      metaDescription:
        'The rules for registering for and taking part in the Sirat Leadership Olympiad.',
      sections: [
        {
          heading: 'About these terms',
          paragraphs: [
            'These terms are the rules for registering for and taking part in the Sirat Leadership Olympiad. By registering, you agree to them. If you are under 18, please read them with a parent or guardian.',
          ],
        },
        {
          heading: 'Who can take part',
          paragraphs: [
            'Students from class 5 up to postgraduate level can take part, in the classes listed on the registration form.',
            'Your category (Activist, Ambassador or Achiever) follows the class you choose when you register, so please choose your real class. The organiser can correct the class, and with it the category, before your first exam.',
          ],
        },
        {
          heading: 'Your account',
          paragraphs: [
            'One account per person. An email address and a mobile number can belong to one account only.',
            'Give true details and keep your password to yourself. You need to confirm your email address before you can start an exam.',
          ],
        },
        {
          heading: 'Registration fee',
          paragraphs: [
            'The fee is shown on the registration form and is paid online through PayStation. Your registration is complete only after PayStation confirms the payment. The refund policy explains when the fee can be returned.',
          ],
        },
        {
          heading: 'The exam',
          paragraphs: [
            'Each exam has a window set by the organiser, and each student has one attempt. The timer runs on our server: it keeps running if your connection drops, and you can come back while time is left.',
            'Your answers are saved on your device and on our server as you go. When the time is up, they are submitted automatically. If your device cannot submit them, the answers we saved last are submitted for you after the time is over.',
          ],
        },
        {
          heading: 'Fair play',
          paragraphs: [
            'Answer on your own, and do not share the questions. Leaving the exam page for another tab or app, or opening developer tools, counts as a warning. After five warnings, the sixth ends the exam and submits the answers given so far.',
            'The organiser may block an account that breaks these rules. A blocked account is left out of the results.',
          ],
        },
        {
          heading: 'Results',
          paragraphs: [
            'Results are published after the exam window has closed for everyone. Students are ranked by score; with an equal score, the shorter time comes first, and an equal score and time share a rank.',
            'After publication, you can see your own score, your answers and the correct answers on your dashboard. The leaderboard shows each student’s rank, name and institution.',
          ],
        },
        {
          heading: 'If you think an answer is wrong',
          paragraphs: [
            'If you believe an answer in the answer key is wrong, write to us. If the organiser agrees, it corrects the key, every student’s score for that exam is recalculated, and the results are published again.',
          ],
        },
        {
          heading: 'Rounds and certificates',
          paragraphs: [
            'Top students of each category may go on to further rounds, as the organiser announces. In a video round, judges score the videos without seeing names.',
            'Certificates are issued online. Anyone with a certificate’s code can check that it is real.',
          ],
        },
        {
          heading: 'Changes and announcements',
          paragraphs: [
            'The organiser may change dates or rules. Changes are announced on the student dashboard.',
          ],
        },
        {
          heading: 'Privacy',
          paragraphs: ['The privacy policy explains how we handle your personal information.'],
        },
        {
          heading: 'Law',
          paragraphs: ['These terms are governed by the laws of Bangladesh.'],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'Last updated: 3 November 2026. If we change these terms, we will publish the new version on this page.',
          ],
        },
      ],
    },
    refund: {
      title: 'Refund policy',
      metaDescription:
        'When the Sirat Leadership Olympiad registration fee can be refunded, and how to ask.',
      sections: [
        {
          heading: 'The registration fee',
          paragraphs: [
            'The registration fee is non-refundable.',
            'The only exceptions are the two cases below.',
          ],
        },
        {
          heading: 'When we refund',
          paragraphs: [
            'You were charged more than once for the same registration.',
            'PayStation confirmed your payment, but we could not complete your registration: for example, the email address or mobile number already belonged to another account.',
          ],
        },
        {
          heading: 'How to ask for a refund',
          paragraphs: [
            'Write to us with the invoice number of each payment and the email address or mobile number you registered with. Use the contact details at the bottom of this page.',
            'Refunds are not automatic. The organiser checks the payment with PayStation and returns the money through PayStation. How long it takes to reach you depends on PayStation and on your bank or mobile wallet.',
          ],
        },
        {
          heading: 'If a payment seems stuck',
          paragraphs: [
            'Your registration is complete only after PayStation confirms the payment. If money was taken but you did not get a confirmation, please do not pay again: write to us with your invoice number, and we will check it.',
          ],
        },
        {
          heading: 'Changes to this policy',
          paragraphs: [
            'Last updated: 3 November 2026. If we change this policy, we will publish the new version on this page.',
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
      metaDescription:
        'সিরাত লিডারশিপ অলিম্পিয়াড কোন ব্যক্তিগত তথ্য নেয়, কেন নেয়, কারা দেখতে পায় আর কত দিন রাখে।',
      sections: [
        {
          heading: 'এই নীতি সম্পর্কে',
          paragraphs: [
            'সিরাত লিডারশিপ অলিম্পিয়াড পরিচালনা করেন এই পাতার নিচে লেখা আয়োজক। এই ওয়েবসাইটে আমরা কী তথ্য নিই, কেন নিই, কারা তা দেখতে পায় আর কত দিন রাখি, এই নীতিতে তা বলা হয়েছে। ওয়েবসাইট আসলে যেভাবে কাজ করে, ঠিক সেভাবেই লিখেছি।',
          ],
        },
        {
          heading: 'আমরা কী তথ্য নিই',
          paragraphs: [
            'রেজিস্ট্রেশনের সময়: আপনার নাম, মোবাইল নম্বর, ইমেইল, জেলা, শিক্ষাপ্রতিষ্ঠান, শিক্ষার ধরন আর শ্রেণি, আর কোনো অ্যাম্বাসেডরের প্রোমো কোড ব্যবহার করলে সেই কোড। আপনার পাসওয়ার্ড এমনভাবে বদলে রাখা হয় যে তা থেকে আর পাসওয়ার্ড ফিরে পাওয়া যায় না।',
            'পেমেন্টের সময়: PayStation আমাদের জানায় ইনভয়েস নম্বর, টাকার পরিমাণ, পেমেন্ট সফল হয়েছে কি না আর লেনদেনের রেফারেন্স। কার্ড বা মোবাইল ওয়ালেটের তথ্য আপনি PayStation-এর নিজের পাতায় দেন, তা আমাদের কাছে কখনো আসে না।',
            'পরীক্ষার সময়: আপনার উত্তর, কখন শুরু করলেন আর কখন জমা দিলেন, আপনার নম্বর আর কত সময় লাগল। পরীক্ষার পাতা আরও রেকর্ড রাখে কখন আপনি অন্য ট্যাব বা অ্যাপে গেলেন, কখন ডেভেলপার টুলস খোলা হলো, আর কখন ইন্টারনেট চলে গেল ও ফিরে এল।',
            'ভিডিও রাউন্ডে: আপনার পাঠানো ভিডিওর লিংক।',
            'অ্যাকাউন্ট নিরাপদ রাখতে: লগইনের রেকর্ড, তার IP ঠিকানা আর কোন ব্রাউজার থেকে এসেছে সহ, আর অ্যাডমিন অংশে আয়োজকের কর্মীরা কী করেন তার রেকর্ড।',
          ],
        },
        {
          heading: 'কেন ব্যবহার করি',
          paragraphs: [
            'আপনার রেজিস্ট্রেশন আর পেমেন্ট নিশ্চিত করতে, আপনাকে লগইন করতে দিতে, সৎভাবে পরীক্ষা চালাতে, ফল হিসাব করে প্রকাশ করতে, পরের রাউন্ডে শিক্ষার্থী বাছাই করতে, সার্টিফিকেট দিতে, আর ওয়েবসাইট ও আপনার অ্যাকাউন্ট নিরাপদ রাখতে।',
            'আমরা আপনাকে ইমেইল পাঠাই শুধু আপনার ইমেইল নিশ্চিত করতে আর আপনি পাসওয়ার্ড রিসেট করতে চাইলে। আপনার তথ্য বিজ্ঞাপনে ব্যবহার করি না, আর কখনো বিক্রি করি না।',
          ],
        },
        {
          heading: 'কারা দেখতে পায়',
          paragraphs: [
            'অন্য শিক্ষার্থীরা: কোনো পরীক্ষার ফল প্রকাশের পরে লগইন করা অংশগ্রহণকারীরা তার লিডারবোর্ড দেখতে পারে। সেখানে প্রত্যেক শিক্ষার্থীর শুধু অবস্থান, নাম আর শিক্ষাপ্রতিষ্ঠান দেখা যায়। আপনার নম্বর, সময়, মোবাইল নম্বর বা ইমেইল অন্য শিক্ষার্থীরা কখনো দেখে না।',
            'আপনি: ফল প্রকাশের পরে নিজের ড্যাশবোর্ডে আপনার নম্বর, আপনার উত্তর আর সঠিক উত্তর দেখতে পাবেন।',
            'ভিডিও রাউন্ডের বিচারকেরা দেখেন একটি এন্ট্রি নম্বর, ক্যাটাগরি আর আপনার ভিডিওর লিংক। আপনার নাম বা যোগাযোগের তথ্য কখনো দেখেন না।',
            'অ্যাম্বাসেডর: যাঁর প্রোমো কোড আপনি ব্যবহার করেছেন, তিনি শুধু দেখেন কতজন কোডটি ব্যবহার করেছে, কারা করেছে তা নয়। কোনো অ্যাম্বাসেডর দলে যোগ দিলে দলের অন্য সদস্যরা শুধু আপনার নামের প্রথম অংশ দেখে।',
            'সার্টিফিকেট: আপনি যাকে সার্টিফিকেটের কোড দেবেন, তিনি সেটি যাচাই করতে পারবেন। যাচাইয়ে শুধু আপনার নাম আর পুরস্কার দেখা যায়।',
            'আয়োজকের কর্মীরা: অলিম্পিয়াড চালানোর জন্য অ্যাডমিনরা রেজিস্ট্রেশনের তথ্য, পেমেন্ট আর পরীক্ষার রেকর্ড দেখতে পারেন; ম্যানেজাররা ইমেইল আর নম্বরসহ পুরো লিডারবোর্ড দেখতে পারেন। অ্যাডমিনরা পাসওয়ার্ড আর একটি অথেনটিকেটর অ্যাপের কোড দিয়ে লগইন করেন, আর তাঁদের প্রতিটি কাজের রেকর্ড থাকে।',
            'যেসব সেবাদাতা আমাদের হয়ে তথ্য নিয়ে কাজ করে: PayStation (পেমেন্ট), Amazon Web Services-এর ইমেইল সেবা (আপনাকে পাঠানো ইমেইল) আর Hostinger (যে সার্ভারে এই ওয়েবসাইট চলে)।',
          ],
        },
        {
          heading: 'কত দিন রাখি',
          paragraphs: [
            'আপনার অ্যাকাউন্ট, পরীক্ষার উত্তর ও ফল, আর পেমেন্টের রেকর্ড রাখা হয়; এগুলো নিজে থেকে মোছা হয় না। আপনি অ্যাকাউন্ট মুছে ফেলতে বলতে পারেন (নিচে “আপনার অধিকার” দেখুন)।',
            'যে রেজিস্ট্রেশন শুরু করে শেষ করেননি: পাসওয়ার্ডসহ ফর্মটি আপনার শেষ ধাপের ৩০ দিন পরে মুছে ফেলা হয়। রেজিস্ট্রেশন সম্পূর্ণ হলে ফর্মের সেই কপি সঙ্গে সঙ্গে মোছা হয়।',
            'লগইন সেশন শেষ হওয়ার ৩০ দিন পরে মুছে ফেলা হয়, আর ইমেইলে পাঠানো লিংক মেয়াদ শেষের ৭ দিন পরে।',
            'ডেটাবেসের এনক্রিপ্ট করা ব্যাকআপ কপি সার্ভারের বাইরে রাখা হয়; সবচেয়ে পুরোনোটি প্রায় পাঁচ সপ্তাহের।',
          ],
        },
        {
          heading: '১৮ বছরের কম বয়সী শিক্ষার্থী',
          paragraphs: [
            'অনেক অংশগ্রহণকারীর বয়স ১৮-র কম। আপনার বয়স ১৮-র কম হলে মা-বাবা বা অভিভাবকের জানা ও সম্মতি নিয়ে রেজিস্ট্রেশন করুন। মা-বাবা বা অভিভাবক যেকোনো সময় আমাদের লিখে সন্তানের তথ্য দেখতে, ঠিক করতে বা মুছে ফেলতে বলতে পারেন।',
            'অলিম্পিয়াডের জন্য যা দরকার, আমরা শুধু তা-ই নিই: জন্মতারিখ, ছবি বা মা-বাবা ও অভিভাবকের কোনো তথ্য নিই না।',
          ],
        },
        {
          heading: 'কুকি',
          paragraphs: [
            'ওয়েবসাইটের যতটুকু দরকার, শুধু ততটুকু কুকি ব্যবহার করি: লগইন রাখতে, অ্যাডমিনের লগইনের দ্বিতীয় ধাপের জন্য, শুরু করা রেজিস্ট্রেশন আবার চালিয়ে যেতে, আর আপনার ভাষা মনে রাখতে। বিজ্ঞাপন, অ্যানালিটিক্স বা ট্র্যাকিংয়ের কোনো কুকি নেই, অন্য কোনো প্রতিষ্ঠানের ট্র্যাকিং টুলও নেই।',
          ],
        },
        {
          heading: 'আপনার অধিকার',
          paragraphs: [
            'ড্যাশবোর্ডের প্রোফাইলে আপনার তথ্য দেখতে আর নাম, মোবাইল নম্বর, জেলা, শিক্ষাপ্রতিষ্ঠান ও শিক্ষার ধরন ঠিক করতে পারবেন। ইমেইল বা শ্রেণি ঠিক করতে আমাদের লিখুন; শ্রেণি শুধু প্রথম পরীক্ষার আগে ঠিক করা যায়।',
            'আপনার কী তথ্য আমাদের কাছে আছে জানতে চাইতে পারেন, বা অ্যাকাউন্ট মুছে ফেলতে বলতে পারেন। অ্যাকাউন্ট মুছতে বললে আমরা অ্যাকাউন্টটি বন্ধ করি আর যতটা সম্ভব তথ্য মুছে ফেলি। পেমেন্টের রেকর্ড, জমা দেওয়া পরীক্ষা ও ফল, আর নিরাপত্তার রেকর্ড রেখে দিই, কারণ পেমেন্টের প্রশ্নের উত্তর দিতে, ফল সঠিক রাখতে আর ওয়েবসাইট নিরাপদ রাখতে এগুলো দরকার।',
            'এই পাতার নিচে দেওয়া যোগাযোগের তথ্য ব্যবহার করুন।',
          ],
        },
        {
          heading: 'এই নীতির পরিবর্তন',
          paragraphs: [
            'সর্বশেষ হালনাগাদ: ৩ নভেম্বর ২০২৬। এই নীতি বদলালে নতুন সংস্করণ এই পাতায় প্রকাশ করব।',
          ],
        },
      ],
    },
    terms: {
      title: 'শর্তাবলি',
      metaDescription: 'সিরাত লিডারশিপ অলিম্পিয়াডে রেজিস্ট্রেশন আর অংশগ্রহণের নিয়ম।',
      sections: [
        {
          heading: 'এই শর্তাবলি সম্পর্কে',
          paragraphs: [
            'সিরাত লিডারশিপ অলিম্পিয়াডে রেজিস্ট্রেশন আর অংশগ্রহণের নিয়ম এই শর্তাবলিতে দেওয়া আছে। রেজিস্ট্রেশন করলে আপনি এগুলো মেনে নিচ্ছেন। আপনার বয়স ১৮-র কম হলে মা-বাবা বা অভিভাবকের সঙ্গে পড়ে নিন।',
          ],
        },
        {
          heading: 'কারা অংশ নিতে পারে',
          paragraphs: [
            'পঞ্চম শ্রেণি থেকে স্নাতকোত্তর পর্যন্ত শিক্ষার্থীরা অংশ নিতে পারে, রেজিস্ট্রেশন ফর্মে দেওয়া শ্রেণিগুলো অনুযায়ী।',
            'আপনার ক্যাটাগরি (অ্যাক্টিভিস্ট, অ্যাম্বাসেডর বা অ্যাচিভার) রেজিস্ট্রেশনে বেছে নেওয়া শ্রেণি থেকে ঠিক হয়, তাই আপনার আসল শ্রেণিটি বেছে নিন। প্রথম পরীক্ষার আগে আয়োজক শ্রেণি, আর সেই সঙ্গে ক্যাটাগরি, ঠিক করে দিতে পারেন।',
          ],
        },
        {
          heading: 'আপনার অ্যাকাউন্ট',
          paragraphs: [
            'একজনের একটিই অ্যাকাউন্ট। একটি ইমেইল আর একটি মোবাইল নম্বর শুধু একটি অ্যাকাউন্টের হতে পারে।',
            'সঠিক তথ্য দিন আর পাসওয়ার্ড কাউকে জানাবেন না। পরীক্ষা শুরুর আগে আপনার ইমেইল নিশ্চিত করতে হবে।',
          ],
        },
        {
          heading: 'রেজিস্ট্রেশন ফি',
          paragraphs: [
            'ফি রেজিস্ট্রেশন ফর্মে দেখানো হয়, আর PayStation-এর মাধ্যমে অনলাইনে দিতে হয়। PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন সম্পূর্ণ হয়। কখন ফি ফেরত দেওয়া যায়, তা ফেরত নীতিতে বলা আছে।',
          ],
        },
        {
          heading: 'পরীক্ষা',
          paragraphs: [
            'প্রতিটি পরীক্ষার একটি সময়সীমা আয়োজক ঠিক করেন, আর প্রত্যেক শিক্ষার্থী একবারই পরীক্ষা দিতে পারে। সময় চলে আমাদের সার্ভারে: ইন্টারনেট চলে গেলেও সময় চলতে থাকে, আর সময় বাকি থাকলে আবার ফিরে আসা যায়।',
            'আপনার উত্তর চলতে চলতে আপনার ডিভাইসে আর আমাদের সার্ভারে সংরক্ষিত হয়। সময় শেষ হলে উত্তরগুলো নিজে থেকেই জমা হয়ে যায়। আপনার ডিভাইস জমা দিতে না পারলে, সময় শেষ হওয়ার পরে আমাদের কাছে সর্বশেষ সংরক্ষিত উত্তরগুলো আপনার হয়ে জমা দেওয়া হয়।',
          ],
        },
        {
          heading: 'সৎভাবে অংশ নেওয়া',
          paragraphs: [
            'নিজে উত্তর দিন, আর প্রশ্ন কারো সঙ্গে শেয়ার করবেন না। পরীক্ষার পাতা ছেড়ে অন্য ট্যাব বা অ্যাপে গেলে, বা ডেভেলপার টুলস খুললে, একটি সতর্কতা গোনা হয়। পাঁচটি সতর্কতার পরে ষষ্ঠবারে পরীক্ষা শেষ হয়ে যায়, আর তখন পর্যন্ত দেওয়া উত্তর জমা হয়।',
            'এই নিয়ম ভাঙলে আয়োজক অ্যাকাউন্ট বন্ধ করতে পারেন। বন্ধ করা অ্যাকাউন্ট ফলাফলে থাকে না।',
          ],
        },
        {
          heading: 'ফলাফল',
          paragraphs: [
            'সবার জন্য পরীক্ষার সময় শেষ হওয়ার পরে ফল প্রকাশ হয়। নম্বর অনুযায়ী ক্রম ঠিক হয়; সমান নম্বরে কম সময় লাগা শিক্ষার্থী আগে থাকে, আর নম্বর ও সময় দুটোই সমান হলে অবস্থানও একই হয়।',
            'ফল প্রকাশের পরে নিজের ড্যাশবোর্ডে আপনার নম্বর, আপনার উত্তর আর সঠিক উত্তর দেখতে পাবেন। লিডারবোর্ডে প্রত্যেক শিক্ষার্থীর অবস্থান, নাম আর শিক্ষাপ্রতিষ্ঠান দেখা যায়।',
          ],
        },
        {
          heading: 'কোনো উত্তর ভুল মনে হলে',
          paragraphs: [
            'উত্তরমালার কোনো উত্তর ভুল মনে হলে আমাদের লিখুন। আয়োজক একমত হলে উত্তরটি ঠিক করা হয়, ওই পরীক্ষায় সব শিক্ষার্থীর নম্বর আবার হিসাব হয়, আর ফল আবার প্রকাশ করা হয়।',
          ],
        },
        {
          heading: 'রাউন্ড আর সার্টিফিকেট',
          paragraphs: [
            'আয়োজকের ঘোষণা অনুযায়ী প্রতিটি ক্যাটাগরির সেরা শিক্ষার্থীরা পরের রাউন্ডে যেতে পারে। ভিডিও রাউন্ডে বিচারকেরা নাম না দেখেই ভিডিওতে নম্বর দেন।',
            'সার্টিফিকেট অনলাইনে দেওয়া হয়। সার্টিফিকেটের কোড থাকলে যে কেউ যাচাই করতে পারে সেটি আসল কি না।',
          ],
        },
        {
          heading: 'পরিবর্তন আর ঘোষণা',
          paragraphs: [
            'আয়োজক তারিখ বা নিয়ম বদলাতে পারেন। পরিবর্তন শিক্ষার্থীর ড্যাশবোর্ডে জানানো হয়।',
          ],
        },
        {
          heading: 'গোপনীয়তা',
          paragraphs: ['আপনার ব্যক্তিগত তথ্য আমরা কীভাবে রাখি, তা গোপনীয়তা নীতিতে বলা আছে।'],
        },
        {
          heading: 'আইন',
          paragraphs: ['এই শর্তাবলি বাংলাদেশের আইন অনুযায়ী চলবে।'],
        },
        {
          heading: 'এই শর্তাবলির পরিবর্তন',
          paragraphs: [
            'সর্বশেষ হালনাগাদ: ৩ নভেম্বর ২০২৬। এই শর্তাবলি বদলালে নতুন সংস্করণ এই পাতায় প্রকাশ করব।',
          ],
        },
      ],
    },
    refund: {
      title: 'ফেরত নীতি',
      metaDescription:
        'সিরাত লিডারশিপ অলিম্পিয়াডের রেজিস্ট্রেশন ফি কখন ফেরত দেওয়া যায়, আর কীভাবে চাইবেন।',
      sections: [
        {
          heading: 'রেজিস্ট্রেশন ফি',
          paragraphs: ['রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়।', 'ব্যতিক্রম শুধু নিচের দুটি ক্ষেত্র।'],
        },
        {
          heading: 'কখন ফেরত দিই',
          paragraphs: [
            'একই রেজিস্ট্রেশনের জন্য আপনার কাছ থেকে একাধিকবার টাকা কাটা হয়েছে।',
            'PayStation আপনার পেমেন্ট নিশ্চিত করেছে, কিন্তু আমরা রেজিস্ট্রেশন সম্পূর্ণ করতে পারিনি: যেমন ইমেইল বা মোবাইল নম্বরটি আগে থেকেই অন্য অ্যাকাউন্টের ছিল।',
          ],
        },
        {
          heading: 'কীভাবে ফেরত চাইবেন',
          paragraphs: [
            'প্রতিটি পেমেন্টের ইনভয়েস নম্বর আর রেজিস্ট্রেশনে দেওয়া ইমেইল বা মোবাইল নম্বরসহ আমাদের লিখুন। এই পাতার নিচে দেওয়া যোগাযোগের তথ্য ব্যবহার করুন।',
            'টাকা নিজে থেকে ফেরত যায় না। আয়োজক PayStation-এর সঙ্গে পেমেন্টটি মিলিয়ে দেখেন আর PayStation-এর মাধ্যমে টাকা ফেরত দেন। টাকা আপনার কাছে পৌঁছাতে কত সময় লাগবে, তা PayStation আর আপনার ব্যাংক বা মোবাইল ওয়ালেটের ওপর নির্ভর করে।',
          ],
        },
        {
          heading: 'পেমেন্ট আটকে আছে মনে হলে',
          paragraphs: [
            'PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন সম্পূর্ণ হয়। টাকা কেটে নেওয়া হয়েছে অথচ নিশ্চিতকরণ পাননি, এমন হলে আবার পেমেন্ট করবেন না: ইনভয়েস নম্বরসহ আমাদের লিখুন, আমরা দেখে নেব।',
          ],
        },
        {
          heading: 'এই নীতির পরিবর্তন',
          paragraphs: [
            'সর্বশেষ হালনাগাদ: ৩ নভেম্বর ২০২৬। এই নীতি বদলালে নতুন সংস্করণ এই পাতায় প্রকাশ করব।',
          ],
        },
      ],
    },
  },
});

export type LegalMessages = (typeof legalMessages)['en'];
