import { site } from '../../content/site.ts';
import { defineMessages } from '../messages.ts';

/*
 * The public homepage, FIRST DRAFT (owner, 2026-11-03). Bangla from the client's two PDFs; English is our
 * translation. Everything here is "to confirm" with the client. Plain text only: `{saw}` marks where the honorific
 * (brand.honorific, one key; the name comes from content/site.ts) goes, rendered by <WithHonorific>. Facts with numbers or dates live in
 * content/home.ts; the fee comes from the API.
 */
export const homeMessages = defineMessages({
  en: {
    brand: {
      name: site.name.en,
      season: site.season,
      /** The honorific after the Prophet's name. If ﷺ renders badly, the plain form is "(pbuh)". */
      honorific: 'ﷺ',
      home: 'Home page',
    },
    shell: { skip: 'Skip to main content', footerNav: 'Site links' },
    metaDescription:
      'The country’s largest Sirat event, on the life and ideals of the Messenger of Allah {saw}: groups, syllabus, rounds, prizes and dates.',
    hero: {
      tagline:
        'The country’s largest Sirat event, on the life and ideals of the Messenger of Allah {saw}',
      register: 'Register now',
      howTo: 'How to take part',
      window: (from: string, to: string) => `Registration: ${from} – ${to}`,
      open: 'Registration is open.',
      closed: 'Registration is not open right now.',
    },
    fee: {
      amount: (amount: string, currency: string) =>
        currency === 'BDT' ? `${amount} taka` : `${amount} ${currency}`,
      line: (amount: string) => `Registration fee: ${amount}`,
      unknown: 'The registration fee is shown when you register.',
    },
    intro: {
      kicker: 'About the olympiad',
      title: 'What is the Sirat Olympiad, and why?',
      paragraphs: [
        'When injustice, crime and oppression had spread into every corner of a darkened world, when the cries of the oppressed weighed on the air day after day and humanity lay fallen, the one sent as a mercy to the worlds came as the liberator of all humanity.',
        'Many civilisations and ideals have vanished over time, yet the life of the greatest of all people, Muhammad {saw}, is still a steady light for humankind. As young people drift away from studying the Sirat under the pull of technology and a mechanical modern life, the ‘Bangladesh Sirat Olympiad’ began out of that gap and a deep sense of social duty. It is not a dry test of talent but a cultural and educational movement that helps young minds look within and return to the Prophetic ideals.',
      ],
      quote:
        'The ‘Bangladesh Sirat Olympiad’ is a noble effort to raise a bright generation, alive with Prophetic values, through the spiritual and intellectual growth of young people.',
    },
    goals: {
      kicker: 'Aims and objectives',
      title: 'What we want to do',
      lead: 'The main aim is to present the Sirat of the Prophet {saw} clearly and authentically, beyond formal and complex theory; to inspire its practice in daily life; to build research-based reading habits; to bring students of different streams together; and, by joining institutional knowledge with ethics and humanity, to raise honest, wise and responsible leaders for tomorrow.',
      items: [
        'Build reading habits grounded in knowledge and research',
        'Present the Sirat authentically',
        'Raise a generation alive with Prophetic values',
      ],
      closing:
        'The ‘Bangladesh Sirat Olympiad’ is not a one-off event; it is a humble social effort to plant a lasting love for the Messenger of Allah {saw} in young hearts. We believe it will help build a new Bangladesh rooted in knowledge and values, whose people grow themselves and contribute strongly to the good of all humanity.',
    },
    groups: {
      kicker: 'Groups and taking part',
      title: 'Two age groups',
      lead: 'The groups, the registration fee and how to take part, at a glance.',
      junior: {
        name: 'Junior group',
        age: 'Under 18',
        who: 'Students and others of any level up to 18 years of age can take part.',
      },
      senior: {
        name: 'Senior group',
        age: '18 and over',
        who: 'Students of any level and professionals over 18 can take part.',
      },
      modeTitle: 'How you take part',
      online: {
        title: 'Online',
        text: 'Take the exam online from any device with an internet connection.',
      },
      offline: {
        title: 'Offline',
        text: 'Take the exam in person at the assigned centre in your divisional city.',
      },
      feeTitle: 'Registration fee',
      feeNote: 'Paid online through PayStation (mobile banking, cards and more).',
    },
    syllabus: {
      kicker: 'Syllabus',
      title: 'What to read',
      lead: 'Each group has its set books, and no question comes from outside them.',
      junior: { group: 'Junior group', books: ['Ar-Raheeq Al-Makhtum', 'Nobijir Golpo'] },
      senior: { group: 'Senior group', books: ['Ar-Raheeq Al-Makhtum', 'Sirat Ibn Hisham'] },
      count: (count: string) => `${count} books`,
      freeBookTitle: 'One book free',
      freeBook:
        'Everyone who pays the registration fee gets one book free. After paying, log in and give a delivery address on your dashboard, and the book will reach you, in sha Allah.',
    },
    rounds: {
      kicker: 'The stages',
      title: 'Three rounds, one path',
      lead: 'Only those who pass a round take part in the next one.',
      method: (method: string) => `Method: ${method}`,
      selection: {
        name: 'Selection round',
        method: 'MCQ',
        detail: 'A multiple-choice exam, online, from any device with an internet connection.',
      },
      knockout: {
        name: 'Knockout qualifiers',
        video: 'video submission',
        viva: 'viva',
        detail: (count: string) => `${count} contestants from both groups go through to the final.`,
      },
      final: {
        name: 'Final round',
        method: 'Sirat presentation',
        detail: (marks: string) =>
          `In the style of a television reality show, ${marks} marks per episode. Contestants meet each episode’s challenge on the way to the grand finale and the top prize.`,
      },
    },
    prizes: {
      kicker: 'Prizes',
      title: 'Honours for the best',
      lead: 'Each group has its own prizes, and the champion of each group wins an Umrah journey.',
      champion: { title: 'Champion', prize: 'Umrah journey and a gold medal' },
      runnerUp: { title: 'Runner-up', prize: 'Laptop and a silver medal' },
      finalists: { title: 'Finalists', prize: 'Scholarship, crest and certificate' },
      knockout: { title: 'Knockout qualifiers', prize: 'A special souvenir' },
      everyone: { title: 'Every participant', prize: 'Certificate' },
      note: 'There will also be book sets, gadgets, cash prizes and crests.',
      /** What the client's own PDF says; shown until the old site's prize details are confirmed. */
      pdf: {
        champion: 'An Umrah journey',
        toBeAnnounced: 'The prize will be announced soon.',
        moreTitle: 'More prizes',
        more: 'There will be book sets, gadgets, cash, certificates, crests and more. Each group has its own prizes.',
      },
    },
    roadmap: {
      kicker: 'Schedule',
      title: 'Important dates',
      lead: 'If a date changes, we announce it on this page and on every registered participant’s dashboard.',
      registrationOpens: 'Registration opens',
      registrationCloses: 'Registration closes',
      selection: 'Selection round',
      selectionResult: 'Selection round results',
      knockout: 'Knockout qualifiers',
      final: 'Final',
      tba: 'To be announced',
    },
    highlights: {
      kicker: 'Last season',
      title: 'What happened last season',
      lead: 'Bangladesh Sirat Olympiad 2025 in numbers.',
      stats: [
        { value: '5 million+', label: 'Engagement' },
        { value: '64', label: 'Districts' },
        { value: '1,000+', label: 'Institutions' },
        { value: '1,000', label: 'Ambassadors' },
      ],
      album: 'See the album',
      newTab: '(opens in a new tab)',
    },
    ambassador: {
      kicker: 'Ambassador programme',
      title: 'Represent the olympiad where you live',
      lead: 'College and university students can bring the olympiad to their institution and area, alone or with a team.',
      tasksTitle: 'What ambassadors do',
      tasks: [
        'Assigned tasks',
        'Field work',
        'Collecting registrations',
        'Point tracking',
        'Reaching targets',
        'Honours and recognition',
      ],
      note: 'Referral points are added only after the referred participant’s payment succeeds.',
      join: 'Join as an ambassador',
      how: 'Complete your registration and contact us; the organisers turn your account into an ambassador account.',
      cta: 'Contact us',
    },
    faq: {
      kicker: 'Questions and answers',
      title: 'Frequently asked questions',
      links: {
        register: 'Go to registration',
        roadmap: 'See the roadmap',
        prizes: 'See the prizes',
        rounds: 'See the stages',
        syllabus: 'See the syllabus',
      },
      items: [
        {
          id: 'register',
          question: 'I want to register.',
          answer:
            'Welcome. Fill in the form with the required details and pay to complete your registration.',
        },
        {
          id: 'roadmap',
          question: 'What is the olympiad’s roadmap?',
          answer:
            'The dates of registration, the selection round, the knockout and the final are in the roadmap on this page.',
        },
        {
          id: 'prizes',
          question: 'What are the prizes of season three?',
          answer:
            'There will be book sets, gadgets, cash, certificates, crests and more. The champion of each group wins an Umrah journey. Each group has its own prizes.',
        },
        {
          id: 'method',
          question: 'How does the exam work?',
          answer:
            'The exam has three stages. Only those who pass a stage take part in the next one.',
        },
        {
          id: 'final',
          question: 'What happens in the final round?',
          answer:
            'The final round is held in the style of a television reality show. Contestants meet each episode’s challenge and compete in the grand finale for the top prize.',
        },
        {
          id: 'syllabus',
          question: 'Will questions come from outside the syllabus?',
          answer:
            'No. Every question comes from the set books. Questions on understanding and application are also based on what the books say.',
        },
        {
          id: 'books',
          question: 'Where do I get the syllabus books?',
          answer:
            'You can get the books yourself. Everyone who pays the registration fee also gets one book free: give a delivery address on your dashboard after paying, and it will be delivered to you, in sha Allah.',
        },
      ],
    },
    contact: {
      kicker: 'Contact',
      title: 'Ask us anything',
      lead: 'For any question, opinion, complaint or suggestion about the olympiad, contact us directly.',
      email: 'Email',
      emailMissing: 'The contact email will be published here soon.',
      social: 'Follow us',
      networks: {
        facebook: 'Facebook',
        instagram: 'Instagram',
        youtube: 'YouTube',
        telegram: 'Telegram',
      },
      newTab: '(opens in a new tab)',
    },
    finalCta: {
      title: 'Sign up before you start reading',
      cta: 'Register today',
    },
  },
  bn: {
    brand: {
      name: site.name.bn,
      season: site.season,
      honorific: 'ﷺ',
      home: 'প্রথম পাতা',
    },
    shell: { skip: 'মূল অংশে যান', footerNav: 'সাইটের লিংক' },
    metaDescription:
      'রাসূলুল্লাহ {saw}-এর জীবন ও আদর্শ নিয়ে দেশের সর্ববৃহৎ সিরাতভিত্তিক আয়োজন: গ্রুপ, সিলেবাস, পর্যায়, পুরস্কার ও তারিখ।',
    hero: {
      tagline: 'রাসূলুল্লাহ {saw}-এর জীবন ও আদর্শ নিয়ে দেশের সর্ববৃহৎ সিরাতভিত্তিক আয়োজন',
      register: 'রেজিস্ট্রেশন করুন',
      howTo: 'কীভাবে অংশ নেব',
      window: (from: string, to: string) => `রেজিস্ট্রেশন: ${from} – ${to}`,
      open: 'রেজিস্ট্রেশন চলছে।',
      closed: 'এখন রেজিস্ট্রেশন বন্ধ।',
    },
    fee: {
      amount: (amount: string, currency: string) =>
        currency === 'BDT' ? `${amount} টাকা` : `${amount} ${currency}`,
      line: (amount: string) => `রেজিস্ট্রেশন ফি: ${amount}`,
      unknown: 'রেজিস্ট্রেশনের সময় ফি দেখানো হবে।',
    },
    intro: {
      kicker: 'অলিম্পিয়াড পরিচিতি',
      title: 'সিরাত অলিম্পিয়াড কী ও কেন?',
      paragraphs: [
        'তমসাচ্ছন্ন পৃথিবীর রন্ধ্রে রন্ধ্রে যখন অন্যায়-অপরাধ আর জুলুমে ছেয়ে গিয়েছিল, মজলুমের আর্তনাদে যখন প্রতিনিয়ত আকাশ-বাতাস ভারী হয়ে উঠছিল, মানবতা যখন মুখ থুবড়ে পড়েছিল—ঠিক তখনই বিশ্বমানবতার মুক্তির দূত হয়ে আগমন ঘটেছিল রহমাতুল্লিল আলামিনের।',
        'কালের বিবর্তনে বহু সভ্যতা ও আদর্শের বিলুপ্তি ঘটলেও সর্বকালের শ্রেষ্ঠ মানব হযরত মুহাম্মদ {saw}-এর জীবনাদর্শ মানবজাতির জন্য আজও এক অবিচল আলোকবর্তিকা। বর্তমান প্রযুক্তিনির্ভর আধুনিকতা ও যান্ত্রিকতার প্রভাবে তরুণ সমাজ যখন ধীরে ধীরে সিরাত চর্চা থেকে দূরে সরে যাচ্ছে, ঠিক সেই শূন্যতা ও গভীর সামাজিক দায়বদ্ধতা থেকেই যাত্রা শুরু করেছে ‘বাংলাদেশ সিরাত অলিম্পিয়াড’—যা কেবল কোনো মেধা যাচাইয়ের শুষ্ক প্রতিযোগিতা নয়; বরং তরুণদের মননে আত্মানুসন্ধান ও নববী আদর্শে ফিরে আসার এক মহিমান্বিত সাংস্কৃতিক ও শিক্ষাধর্মী আন্দোলন।',
      ],
      quote:
        '‘বাংলাদেশ সিরাত অলিম্পিয়াড’ হলো তরুণদের আত্মিক ও প্রজ্ঞাময় বিকাশ ঘটিয়ে নববী মূল্যবোধে উজ্জীবিত এক আলোকোজ্জ্বল প্রজন্ম গড়ে তোলার একটি সুমহান উদ্যোগ।',
    },
    goals: {
      kicker: 'লক্ষ্য ও উদ্দেশ্য',
      title: 'আমরা কী করতে চাই',
      lead: 'মূল উদ্দেশ্য বিশ্বনবী {saw}-এর সিরাতকে প্রথাগত ও জটিল তত্ত্বের গণ্ডি থেকে বের করে প্রাঞ্জল ও প্রামাণ্যরূপে উপস্থাপন করা, দৈনন্দিন জীবনে সিরাত চর্চার অনুপ্রেরণা জোগানো, গবেষণাভিত্তিক পাঠ্যাভ্যাস তৈরি করা, বিভিন্ন ধারার শিক্ষার্থীদের মাঝে সার্বজনীন মেলবন্ধন সৃষ্টি করা এবং প্রাতিষ্ঠানিক জ্ঞানের সাথে নৈতিকতা ও মানবিকতার সমন্বয় ঘটিয়ে আগামী দিনের জন্য সৎ, প্রজ্ঞাবান ও দায়িত্বশীল নেতৃত্ব গড়ে তোলা।',
      items: [
        'জ্ঞান ও গবেষণাভিত্তিক পাঠাভ্যাস তৈরি',
        'সিরাতকে প্রামাণ্যরূপে উপস্থাপন',
        'নববী মূল্যবোধে উজ্জীবিত প্রজন্ম গঠন',
      ],
      closing:
        '‘বাংলাদেশ সিরাত অলিম্পিয়াড’ কোনো একক আয়োজন নয়; এটি তরুণ হৃদয়ে রাসুলুল্লাহ {saw}-এর প্রতি ভালোবাসার অমর বীজ রোপণের এক বিনম্র সামাজিক প্রচেষ্টা। আমরা বিশ্বাস করি, এই আয়োজনের মধ্য দিয়েই গড়ে উঠবে জ্ঞানভিত্তিক ও মূল্যবোধসম্পন্ন এক নতুন বাংলাদেশ, যারা নিজেদের আত্মউন্নয়নের পাশাপাশি বিশ্বমানবতার সার্বিক কল্যাণে বলিষ্ঠ অবদান রাখবে।',
    },
    groups: {
      kicker: 'গ্রুপ ও অংশগ্রহণ',
      title: 'বয়সভিত্তিক দুটি গ্রুপ',
      lead: 'গ্রুপ, রেজিস্ট্রেশন ফি আর অংশগ্রহণের মাধ্যম এক নজরে।',
      junior: {
        name: 'জুনিয়র গ্রুপ',
        age: 'অনূর্ধ্ব ১৮ বছর',
        who: '১৮ বছর বয়স পর্যন্ত যেকোনো স্তরের শিক্ষার্থী ও ব্যক্তি অংশগ্রহণ করতে পারবেন।',
      },
      senior: {
        name: 'সিনিয়র গ্রুপ',
        age: '১৮ বছর বা তদূর্ধ্ব',
        who: '১৮ বছর বয়সের উপরে যেকোনো স্তরের শিক্ষার্থী ও পেশাজীবী অংশগ্রহণ করতে পারবেন।',
      },
      modeTitle: 'অংশগ্রহণের মাধ্যম',
      online: {
        title: 'অনলাইন',
        text: 'ইন্টারনেট সংযোগসম্পন্ন যেকোনো ডিভাইসের মাধ্যমে অনলাইনে পরীক্ষায় অংশগ্রহণ করতে পারবেন।',
      },
      offline: {
        title: 'অফলাইন',
        text: 'বিভাগীয় শহরের নির্ধারিত কেন্দ্রে যথাসময়ে উপস্থিত হয়ে পরীক্ষায় অংশগ্রহণ করতে পারবেন।',
      },
      feeTitle: 'রেজিস্ট্রেশন ফি',
      feeNote: 'পেমেন্ট অনলাইনে, PayStation-এর মাধ্যমে (মোবাইল ব্যাংকিং, কার্ড ইত্যাদি)।',
    },
    syllabus: {
      kicker: 'সিলেবাস',
      title: 'কী পড়তে হবে',
      lead: 'প্রতিটি গ্রুপের জন্য নির্ধারিত বই ও পাঠ্যসূচি; প্রশ্ন এই সিলেবাসের বাইরে যাবে না।',
      junior: { group: 'জুনিয়র গ্রুপ', books: ['আর-রাহীকুল মাখতূম', 'নবীজির গল্প'] },
      senior: { group: 'সিনিয়র গ্রুপ', books: ['আর-রাহীকুল মাখতূম', 'সীরাতে ইবনে হিশাম'] },
      count: (count: string) => `${count}টি বই`,
      freeBookTitle: 'একটি বই বিনামূল্যে',
      freeBook:
        'রেজিস্ট্রেশন ফি দেওয়া প্রত্যেক অংশগ্রহণকারী একটি বই বিনামূল্যে পাবেন। পেমেন্টের পর লগইন করে ড্যাশবোর্ডে ডেলিভারির ঠিকানা দিন; বই আপনার ঠিকানায় পৌঁছে যাবে, ইনশা আল্লাহ।',
    },
    rounds: {
      kicker: 'প্রতিযোগিতার ধাপ',
      title: 'তিনটি রাউন্ড, একটাই পথ',
      lead: 'প্রতিটি রাউন্ডে উত্তীর্ণ হলেই কেবল পরের রাউন্ডে অংশ নেওয়া যায়।',
      method: (method: string) => `পদ্ধতি: ${method}`,
      selection: {
        name: 'সিলেকশন রাউন্ড',
        method: 'এমসিকিউ',
        detail: 'ইন্টারনেট সংযোগসম্পন্ন যেকোনো ডিভাইস থেকে অনলাইনে বহুনির্বাচনী প্রশ্নের পরীক্ষা।',
      },
      knockout: {
        name: 'নকআউট কোয়ালিফায়ার্স',
        video: 'ভিডিও সাবমিশন',
        viva: 'ভাইভা',
        detail: (count: string) => `উভয় গ্রুপ থেকে মোট ${count} জন ফাইনালে উত্তীর্ণ হবেন।`,
      },
      final: {
        name: 'ফাইনাল রাউন্ড',
        method: 'সিরাত প্রেজেন্টেশন',
        detail: (marks: string) =>
          `টেলিভিশন রিয়েলিটি শো স্টাইলে, প্রতি পর্বে ${marks} নম্বর। বিভিন্ন পর্বের চ্যালেঞ্জ পেরিয়ে প্রতিযোগীরা গ্র্যান্ড ফিনালেতে সর্বোচ্চ পুরস্কারের জন্য লড়বেন।`,
      },
    },
    prizes: {
      kicker: 'পুরস্কার',
      title: 'সেরাদের জন্য সম্মাননা',
      lead: 'দুটি গ্রুপে পৃথকভাবে পুরস্কার দেওয়া হবে; উভয় গ্রুপের চ্যাম্পিয়নের জন্য থাকবে উমরাহ সফর।',
      champion: { title: 'চ্যাম্পিয়ন', prize: 'উমরাহ সফর ও স্বর্ণপদক' },
      runnerUp: { title: 'রানার-আপ', prize: 'ল্যাপটপ ও রৌপ্যপদক' },
      finalists: { title: 'ফাইনালিস্ট', prize: 'স্কলারশিপ, ক্রেস্ট ও সার্টিফিকেট' },
      knockout: { title: 'নকআউট উত্তীর্ণ', prize: 'বিশেষ স্মারক' },
      everyone: { title: 'সকল অংশগ্রহণকারী', prize: 'সার্টিফিকেট' },
      note: 'এ ছাড়া বইসমগ্র, গ্যাজেট, নগদ অর্থ ও ক্রেস্টসহ আরও পুরস্কার থাকবে।',
      pdf: {
        champion: 'উমরাহ সফর',
        toBeAnnounced: 'পুরস্কার শিগগিরই ঘোষণা করা হবে।',
        moreTitle: 'আরও পুরস্কার',
        more: 'বইসমগ্র, গ্যাজেট, নগদ অর্থ, সার্টিফিকেট ও ক্রেস্টসহ বিভিন্ন পুরস্কার থাকবে। দুটি গ্রুপে পৃথকভাবে পুরস্কার প্রদান করা হবে।',
      },
    },
    roadmap: {
      kicker: 'সময়সূচি',
      title: 'গুরুত্বপূর্ণ তারিখ',
      lead: 'তারিখ পরিবর্তিত হলে এই পাতায় আর রেজিস্টার্ড অংশগ্রহণকারীদের ড্যাশবোর্ডে জানিয়ে দেওয়া হবে।',
      registrationOpens: 'রেজিস্ট্রেশন শুরু',
      registrationCloses: 'রেজিস্ট্রেশনের শেষ দিন',
      selection: 'সিলেকশন রাউন্ড',
      selectionResult: 'সিলেকশন রাউন্ডের ফলাফল',
      knockout: 'নকআউট কোয়ালিফায়ার্স',
      final: 'ফাইনাল',
      tba: 'শিগগিরই জানানো হবে',
    },
    highlights: {
      kicker: 'গত আসর',
      title: 'গত আসরে যা হয়েছিল',
      lead: 'সংখ্যায় বাংলাদেশ সিরাত অলিম্পিয়াড ২০২৫।',
      stats: [
        { value: '৫ মিলিয়ন+', label: 'এনগেজমেন্ট' },
        { value: '৬৪', label: 'জেলা' },
        { value: '১,০০০+', label: 'শিক্ষাপ্রতিষ্ঠান' },
        { value: '১,০০০', label: 'অ্যাম্বাসেডর' },
      ],
      album: 'অ্যালবাম দেখুন',
      newTab: '(নতুন ট্যাবে খুলবে)',
    },
    ambassador: {
      kicker: 'অ্যাম্বাসেডর প্রোগ্রাম',
      title: 'নিজের এলাকায় অলিম্পিয়াডের প্রতিনিধি হন',
      lead: 'কলেজ ও বিশ্ববিদ্যালয় পর্যায়ের শিক্ষার্থীরা নিজের প্রতিষ্ঠান ও এলাকায় অলিম্পিয়াড পৌঁছে দিতে পারেন, এককভাবে বা দল গঠন করে।',
      tasksTitle: 'অ্যাম্বাসেডররা যা করেন',
      tasks: [
        'নির্ধারিত টাস্ক',
        'ফিল্ড ওয়ার্ক',
        'রেজিস্ট্রেশন সংগ্রহ',
        'পয়েন্ট ট্র্যাকিং',
        'টার্গেট অর্জন',
        'সম্মাননা ও স্বীকৃতি',
      ],
      note: 'রেফারেল পয়েন্ট যোগ হয় কেবল রেফার করা অংশগ্রহণকারীর পেমেন্ট সফল হওয়ার পর।',
      join: 'অ্যাম্বাসেডর হিসেবে যুক্ত হন',
      how: 'রেজিস্ট্রেশন সম্পন্ন করে আমাদের সাথে যোগাযোগ করুন; আয়োজকেরা আপনার অ্যাকাউন্টকে অ্যাম্বাসেডর অ্যাকাউন্ট করে দেবেন।',
      cta: 'যোগাযোগ করুন',
    },
    faq: {
      kicker: 'প্রশ্নোত্তর',
      title: 'সচরাচর জিজ্ঞাসা',
      links: {
        register: 'রেজিস্ট্রেশন পেজে যান',
        roadmap: 'রোডম্যাপ দেখুন',
        prizes: 'পুরস্কার দেখুন',
        rounds: 'প্রতিযোগিতার ধাপ দেখুন',
        syllabus: 'সিলেবাস দেখুন',
      },
      items: [
        {
          id: 'register',
          question: 'আমি রেজিস্ট্রেশন করতে চাই।',
          answer:
            'আপনাকে স্বাগতম। প্রয়োজনীয় তথ্য দিয়ে ফরম পূরণ করে পেমেন্টের মাধ্যমে রেজিস্ট্রেশন সম্পন্ন করুন।',
        },
        {
          id: 'roadmap',
          question: 'অলিম্পিয়াডের রোডম্যাপ কী?',
          answer:
            'রেজিস্ট্রেশন, সিলেকশন রাউন্ড, নকআউট আর ফাইনালের তারিখ এই পাতার রোডম্যাপ অংশে দেওয়া আছে।',
        },
        {
          id: 'prizes',
          question: 'সিজন থ্রি-এর পুরস্কার কী কী?',
          answer:
            'বইসমগ্র, গ্যাজেট, নগদ অর্থ, সার্টিফিকেট ও ক্রেস্টসহ বিভিন্ন পুরস্কার থাকবে। উভয় গ্রুপের চ্যাম্পিয়নের জন্য থাকবে উমরাহ সফর। দুটি গ্রুপে পৃথকভাবে পুরস্কার প্রদান করা হবে।',
        },
        {
          id: 'method',
          question: 'পরীক্ষা পদ্ধতি কী?',
          answer:
            'পরীক্ষা তিনটি ধাপে অনুষ্ঠিত হবে। পূর্ববর্তী ধাপে উত্তীর্ণ প্রতিযোগীরাই কেবল পরবর্তী ধাপে অংশগ্রহণ করতে পারবেন।',
        },
        {
          id: 'final',
          question: 'ফাইনাল রাউন্ডে কী কী থাকবে?',
          answer:
            'ফাইনাল রাউন্ড টেলিভিশন রিয়েলিটি শো স্টাইলে অনুষ্ঠিত হবে। বিভিন্ন পর্বের চ্যালেঞ্জ উত্তীর্ণ হয়ে প্রতিযোগীরা গ্র্যান্ড ফিনালেতে সর্বোচ্চ পুরস্কারের জন্য প্রতিযোগিতা করবেন।',
        },
        {
          id: 'syllabus',
          question: 'সিলেবাসের বাইরে থেকে প্রশ্ন করা হবে কি?',
          answer:
            'না। সকল প্রশ্ন সিলেবাসভুক্ত বই থেকে করা হবে। অনুধাবনমূলক ও প্রয়োগমূলক প্রশ্নগুলোও বইয়ের তথ্যের ওপর ভিত্তি করে প্রণয়ন করা হবে।',
        },
        {
          id: 'books',
          question: 'সিলেবাসের বই কোথায় পাব?',
          answer:
            'সিলেবাসের বই নিজ উদ্যোগে সংগ্রহ করা যাবে। রেজিস্ট্রেশন ফি দেওয়া প্রত্যেকে একটি বই বিনামূল্যেও পাবেন: পেমেন্টের পর ড্যাশবোর্ডে ঠিকানা দিলে বই আপনার ঠিকানায় পৌঁছে দেওয়া হবে, ইনশা আল্লাহ।',
        },
      ],
    },
    contact: {
      kicker: 'যোগাযোগ',
      title: 'প্রশ্ন থাকলে জিজ্ঞেস করুন',
      lead: 'অলিম্পিয়াড সংশ্লিষ্ট যেকোনো জিজ্ঞাসা, মতামত, অভিযোগ ও পরামর্শ দিতে সরাসরি যোগাযোগ করুন।',
      email: 'ইমেইল',
      emailMissing: 'যোগাযোগের ইমেইল শিগগিরই এখানে দেওয়া হবে।',
      social: 'আমাদের অনুসরণ করুন',
      networks: {
        facebook: 'ফেসবুক',
        instagram: 'ইনস্টাগ্রাম',
        youtube: 'ইউটিউব',
        telegram: 'টেলিগ্রাম',
      },
      newTab: '(নতুন ট্যাবে খুলবে)',
    },
    finalCta: {
      title: 'পড়া শুরু করার আগে নাম লিখিয়ে ফেলুন',
      cta: 'আজই রেজিস্ট্রেশন করুন!',
    },
  },
});
