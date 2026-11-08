import { defineMessages } from '../messages.ts';

/*
 * The multi-page public site (owner, 2026-11-08): the menu, the footer's site map, the homepage's overview, and the
 * pages "How to take part", "Rounds and dates", "Prizes" and "Syllabus". Bangla from the client's PDFs and the old
 * site where the PDFs are silent; how the system works from the system itself (the exam rules are exam's terms,
 * word for word). Facts with numbers or dates live in content/; contested ones are "to confirm" there. English is
 * our translation. Plain text only; `{saw}` is the honorific token (<WithHonorific>).
 */
export const pagesMessages = defineMessages({
  en: {
    menu: {
      label: 'Main menu',
      open: 'Menu',
      about: 'About',
      participate: 'How to take part',
      rounds: 'Rounds and dates',
      prizes: 'Prizes',
      syllabus: 'Syllabus',
    },
    footer: {
      olympiad: 'The olympiad',
      takePart: 'Take part',
      policies: 'Policies',
      register: 'Register',
      login: 'Log in',
    },
    home: {
      introMore: 'More about the olympiad',
      explore: {
        kicker: 'Explore',
        title: 'Everything about the olympiad',
        lead: 'Each topic has its own page.',
      },
      cards: {
        about: 'What the Sirat Olympiad is, why, and its aims.',
        participate: 'The two age groups, registration, the fee and the exam rules.',
        rounds: 'The three rounds and the important dates.',
        prizes: 'An Umrah journey for both champions, and honours for the best.',
        syllabus: 'The set books of each group, and one book free.',
      },
      open: 'Open',
      dates: {
        kicker: 'Dates',
        title: 'Important dates',
        all: 'See the full timeline',
      },
    },
    participate: {
      title: 'How to take part',
      metaDescription:
        'The two age groups, how to register and pay, what you get, and how the exam works.',
      hero: {
        kicker: 'Take part',
        title: 'How to take part',
        lead: 'Two age groups, the exam online, and registration in four steps.',
      },
      steps: {
        kicker: 'Registration',
        title: 'Register in four steps',
        items: [
          {
            title: 'Fill in the form',
            text: 'Your name, mobile number, email, district, institution, type of education and class, and a password you choose.',
          },
          {
            title: 'Pay the fee',
            text: 'Online through PayStation: mobile banking or a card. Your card or wallet details go only to PayStation.',
          },
          {
            title: 'Your account is ready',
            text: 'Registration is complete when PayStation confirms the payment; your account is created then. Confirm your email address with the link we send.',
          },
          {
            title: 'Log in',
            text: 'With your email and password. Your dashboard has your exams, results, the free book and your certificates.',
          },
        ],
      },
      window: (from: string, to: string) => `Registration runs from ${from} to ${to}.`,
      get: {
        kicker: 'What you get',
        title: 'With your registration',
        items: [
          {
            title: 'One book free',
            text: 'After paying, give a delivery address on your dashboard and the book will reach you, in sha Allah.',
          },
          {
            title: 'A certificate',
            text: 'Certificates are issued online, and anyone with a certificate’s code can check that it is real.',
          },
          {
            title: 'Your results',
            text: 'After publication you see your own score, your answers and the correct answers on your dashboard.',
          },
        ],
      },
      exam: {
        kicker: 'The exam',
        title: 'How the exam works',
        items: [
          {
            title: 'One attempt, inside the window',
            text: 'Each exam has a window set by the organiser, and each student has one attempt. You need to confirm your email address before you can start an exam.',
          },
          {
            title: 'The timer runs on our server',
            text: 'It keeps running if your connection drops, and you can come back while time is left.',
          },
          {
            title: 'Your answers are saved as you go',
            text: 'On your device and on our server. When the time is up, they are submitted automatically. If your device cannot submit them, the answers we saved last are submitted for you after the time is over.',
          },
          {
            title: 'Fair play',
            text: 'Answer on your own, and do not share the questions. Leaving the exam page for another tab or app, or opening developer tools, counts as a warning. After five warnings, the sixth ends the exam and submits the answers given so far.',
          },
        ],
      },
      rules: {
        text: 'Every rule is in the terms and conditions.',
        link: 'Terms and conditions',
      },
    },
    rounds: {
      title: 'Rounds and dates',
      metaDescription:
        'The selection round, the knockout qualifiers and the final, and the important dates.',
      hero: {
        kicker: 'The competition',
        title: 'Rounds and dates',
        lead: 'The three rounds, how results are published, and the important dates.',
      },
      results: {
        kicker: 'Results',
        title: 'How results are published',
        items: [
          'Results are published after the exam window has closed for everyone.',
          'Students are ranked by score; with an equal score, the shorter time comes first, and an equal score and time share a rank.',
          'After publication you see your own score, your answers and the correct answers on your dashboard. The leaderboard shows each student’s rank, name and institution.',
        ],
      },
      final: {
        title: 'The final round',
        text: 'The final round is held in the style of a television reality show. Contestants meet each episode’s challenge and compete in the grand finale for the top prize.',
      },
    },
    prizes: {
      title: 'Prizes',
      metaDescription:
        'The prizes of the Sirat Olympiad: an Umrah journey for both champions, laptops, scholarships, crests and certificates.',
      hero: {
        kicker: 'Prizes',
        title: 'Prizes',
        lead: 'From the champions to every participant: who wins what.',
      },
      perGroup: (count: string) => `${count} in each group`,
      pool: (amount: string) => `Prizes worth ${amount} taka across both groups.`,
      certificates: {
        kicker: 'Certificates',
        title: 'A certificate for every participant',
        items: [
          {
            title: 'Online, on your dashboard',
            text: 'Certificates are issued online, and you find yours on your dashboard.',
          },
          {
            title: 'Anyone can check it',
            text: 'Anyone with a certificate’s code can check that it is real. The check shows only the name and the award.',
          },
        ],
      },
    },
    syllabus: {
      title: 'Syllabus and preparation',
      metaDescription:
        'The set books of each group, where the questions come from, and the free book.',
      hero: {
        kicker: 'Preparation',
        title: 'Syllabus and preparation',
        lead: 'Which books to read, where the questions come from, and where to get the books.',
      },
      prep: { kicker: 'Preparation', title: 'Questions and books' },
      questions: {
        title: 'Where the questions come from',
        items: [
          'Every question comes from the set books.',
          'Questions on understanding and application are also based on what the books say.',
        ],
      },
      books: {
        title: 'Where to get the books',
        text: 'You can get the books yourself. Everyone who pays the registration fee also gets one book free: give a delivery address on your dashboard after paying.',
      },
    },
  },
  bn: {
    menu: {
      label: 'প্রধান মেনু',
      open: 'মেনু',
      about: 'পরিচিতি',
      participate: 'অংশগ্রহণ',
      rounds: 'পর্যায় ও তারিখ',
      prizes: 'পুরস্কার',
      syllabus: 'সিলেবাস',
    },
    footer: {
      olympiad: 'অলিম্পিয়াড',
      takePart: 'অংশ নিন',
      policies: 'নীতিমালা',
      register: 'রেজিস্ট্রেশন',
      login: 'লগইন',
    },
    home: {
      introMore: 'অলিম্পিয়াড সম্পর্কে আরও পড়ুন',
      explore: {
        kicker: 'এক নজরে',
        title: 'অলিম্পিয়াডের সবকিছু',
        lead: 'প্রতিটি বিষয়ের জন্য আলাদা পাতা।',
      },
      cards: {
        about: 'সিরাত অলিম্পিয়াড কী, কেন, আর এর লক্ষ্য ও উদ্দেশ্য।',
        participate: 'বয়সভিত্তিক দুটি গ্রুপ, রেজিস্ট্রেশন, ফি আর পরীক্ষার নিয়ম।',
        rounds: 'তিনটি রাউন্ড আর গুরুত্বপূর্ণ তারিখ।',
        prizes: 'উভয় গ্রুপের চ্যাম্পিয়নের জন্য উমরাহ সফর, আর সেরাদের জন্য সম্মাননা।',
        syllabus: 'প্রতিটি গ্রুপের নির্ধারিত বই, আর একটি বই বিনামূল্যে।',
      },
      open: 'দেখুন',
      dates: {
        kicker: 'তারিখ',
        title: 'গুরুত্বপূর্ণ তারিখ',
        all: 'পুরো সময়সূচি দেখুন',
      },
    },
    participate: {
      title: 'কীভাবে অংশ নেবেন',
      metaDescription:
        'বয়সভিত্তিক দুটি গ্রুপ, রেজিস্ট্রেশন ও পেমেন্টের ধাপ, কী পাবেন, আর পরীক্ষা কীভাবে চলে।',
      hero: {
        kicker: 'অংশগ্রহণ',
        title: 'কীভাবে অংশ নেবেন',
        lead: 'বয়সভিত্তিক দুটি গ্রুপ, অনলাইনে পরীক্ষা, আর চার ধাপে রেজিস্ট্রেশন।',
      },
      steps: {
        kicker: 'রেজিস্ট্রেশন',
        title: 'চার ধাপে রেজিস্ট্রেশন',
        items: [
          {
            title: 'ফরম পূরণ করুন',
            text: 'আপনার নাম, মোবাইল নম্বর, ইমেইল, জেলা, শিক্ষাপ্রতিষ্ঠান, শিক্ষার ধরন ও শ্রেণি, আর নিজের বেছে নেওয়া একটি পাসওয়ার্ড।',
          },
          {
            title: 'ফি দিন',
            text: 'অনলাইনে, PayStation-এর মাধ্যমে: মোবাইল ব্যাংকিং বা কার্ডে। কার্ড বা ওয়ালেটের তথ্য শুধু PayStation-এর কাছে যায়।',
          },
          {
            title: 'অ্যাকাউন্ট তৈরি',
            text: 'PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন সম্পূর্ণ হয়, আর তখনই আপনার অ্যাকাউন্ট তৈরি হয়। ইমেইলে পাঠানো লিংক দিয়ে আপনার ইমেইল নিশ্চিত করুন।',
          },
          {
            title: 'লগইন করুন',
            text: 'ইমেইল আর পাসওয়ার্ড দিয়ে। ড্যাশবোর্ডে আপনার পরীক্ষা, ফলাফল, ফ্রি বই আর সার্টিফিকেট।',
          },
        ],
      },
      window: (from: string, to: string) => `রেজিস্ট্রেশন চলবে ${from} থেকে ${to} পর্যন্ত।`,
      get: {
        kicker: 'যা পাবেন',
        title: 'রেজিস্ট্রেশনের সঙ্গে',
        items: [
          {
            title: 'একটি বই বিনামূল্যে',
            text: 'পেমেন্টের পর ড্যাশবোর্ডে ডেলিভারির ঠিকানা দিন; বই আপনার ঠিকানায় পৌঁছে যাবে, ইনশা আল্লাহ।',
          },
          {
            title: 'সার্টিফিকেট',
            text: 'সার্টিফিকেট অনলাইনে দেওয়া হয়। সার্টিফিকেটের কোড থাকলে যে কেউ যাচাই করতে পারে সেটি আসল কি না।',
          },
          {
            title: 'আপনার ফলাফল',
            text: 'ফল প্রকাশের পরে নিজের ড্যাশবোর্ডে আপনার নম্বর, আপনার উত্তর আর সঠিক উত্তর দেখতে পাবেন।',
          },
        ],
      },
      exam: {
        kicker: 'পরীক্ষা',
        title: 'পরীক্ষা কীভাবে চলে',
        items: [
          {
            title: 'সময়সীমার মধ্যে একবার',
            text: 'প্রতিটি পরীক্ষার একটি সময়সীমা আয়োজক ঠিক করেন, আর প্রত্যেক শিক্ষার্থী একবারই পরীক্ষা দিতে পারে। পরীক্ষা শুরুর আগে আপনার ইমেইল নিশ্চিত করতে হবে।',
          },
          {
            title: 'সময় চলে আমাদের সার্ভারে',
            text: 'ইন্টারনেট চলে গেলেও সময় চলতে থাকে, আর সময় বাকি থাকলে আবার ফিরে আসা যায়।',
          },
          {
            title: 'উত্তর সংরক্ষিত হয় চলতে চলতে',
            text: 'আপনার ডিভাইসে আর আমাদের সার্ভারে। সময় শেষ হলে উত্তরগুলো নিজে থেকেই জমা হয়ে যায়। আপনার ডিভাইস জমা দিতে না পারলে, সময় শেষ হওয়ার পরে আমাদের কাছে সর্বশেষ সংরক্ষিত উত্তরগুলো আপনার হয়ে জমা দেওয়া হয়।',
          },
          {
            title: 'সৎভাবে অংশ নেওয়া',
            text: 'নিজে উত্তর দিন, আর প্রশ্ন কারো সঙ্গে শেয়ার করবেন না। পরীক্ষার পাতা ছেড়ে অন্য ট্যাব বা অ্যাপে গেলে, বা ডেভেলপার টুলস খুললে, একটি সতর্কতা গোনা হয়। পাঁচটি সতর্কতার পরে ষষ্ঠবারে পরীক্ষা শেষ হয়ে যায়, আর তখন পর্যন্ত দেওয়া উত্তর জমা হয়।',
          },
        ],
      },
      rules: {
        text: 'সব নিয়ম শর্তাবলিতে দেওয়া আছে।',
        link: 'শর্তাবলি',
      },
    },
    rounds: {
      title: 'পর্যায় ও তারিখ',
      metaDescription: 'সিলেকশন রাউন্ড, নকআউট কোয়ালিফায়ার্স ও ফাইনাল, আর গুরুত্বপূর্ণ তারিখ।',
      hero: {
        kicker: 'প্রতিযোগিতা',
        title: 'পর্যায় ও তারিখ',
        lead: 'তিনটি রাউন্ড, ফল যেভাবে প্রকাশ হয়, আর গুরুত্বপূর্ণ তারিখ।',
      },
      results: {
        kicker: 'ফলাফল',
        title: 'ফল যেভাবে প্রকাশ হয়',
        items: [
          'সবার জন্য পরীক্ষার সময় শেষ হওয়ার পরে ফল প্রকাশ হয়।',
          'নম্বর অনুযায়ী ক্রম ঠিক হয়; সমান নম্বরে কম সময় লাগা শিক্ষার্থী আগে থাকে, আর নম্বর ও সময় দুটোই সমান হলে অবস্থানও একই হয়।',
          'ফল প্রকাশের পরে নিজের ড্যাশবোর্ডে আপনার নম্বর, আপনার উত্তর আর সঠিক উত্তর দেখতে পাবেন। লিডারবোর্ডে প্রত্যেক শিক্ষার্থীর অবস্থান, নাম আর শিক্ষাপ্রতিষ্ঠান দেখা যায়।',
        ],
      },
      final: {
        title: 'ফাইনাল রাউন্ড',
        text: 'ফাইনাল রাউন্ড টেলিভিশন রিয়েলিটি শো স্টাইলে অনুষ্ঠিত হবে। বিভিন্ন পর্বের চ্যালেঞ্জ উত্তীর্ণ হয়ে প্রতিযোগীরা গ্র্যান্ড ফিনালেতে সর্বোচ্চ পুরস্কারের জন্য প্রতিযোগিতা করবেন।',
      },
    },
    prizes: {
      title: 'পুরস্কার',
      metaDescription:
        'সিরাত অলিম্পিয়াডের পুরস্কার: উভয় গ্রুপের চ্যাম্পিয়নের জন্য উমরাহ সফর, ল্যাপটপ, স্কলারশিপ, ক্রেস্ট ও সার্টিফিকেট।',
      hero: {
        kicker: 'পুরস্কার',
        title: 'পুরস্কার',
        lead: 'চ্যাম্পিয়ন থেকে প্রত্যেক অংশগ্রহণকারী: কে কী পাবেন।',
      },
      perGroup: (count: string) => `প্রতিটি গ্রুপে ${count} জন`,
      pool: (amount: string) => `উভয় গ্রুপে মোট ${amount} টাকার সমমানের পুরস্কার।`,
      certificates: {
        kicker: 'সার্টিফিকেট',
        title: 'প্রত্যেক অংশগ্রহণকারীর জন্য সার্টিফিকেট',
        items: [
          {
            title: 'অনলাইনে, আপনার ড্যাশবোর্ডে',
            text: 'সার্টিফিকেট অনলাইনে দেওয়া হয়; নিজেরটি পাবেন আপনার ড্যাশবোর্ডে।',
          },
          {
            title: 'যে কেউ যাচাই করতে পারে',
            text: 'সার্টিফিকেটের কোড থাকলে যে কেউ যাচাই করতে পারে সেটি আসল কি না। যাচাইয়ে শুধু নাম আর পুরস্কার দেখা যায়।',
          },
        ],
      },
    },
    syllabus: {
      title: 'সিলেবাস ও প্রস্তুতি',
      metaDescription: 'প্রতিটি গ্রুপের নির্ধারিত বই, প্রশ্ন কোথা থেকে আসবে, আর বিনামূল্যের বই।',
      hero: {
        kicker: 'প্রস্তুতি',
        title: 'সিলেবাস ও প্রস্তুতি',
        lead: 'কোন বই পড়বেন, প্রশ্ন কোথা থেকে আসবে, আর বই কোথায় পাবেন।',
      },
      prep: { kicker: 'প্রস্তুতি', title: 'প্রশ্ন আর বই' },
      questions: {
        title: 'প্রশ্ন কোথা থেকে আসবে',
        items: [
          'সকল প্রশ্ন সিলেবাসভুক্ত বই থেকে করা হবে।',
          'অনুধাবনমূলক ও প্রয়োগমূলক প্রশ্নগুলোও বইয়ের তথ্যের ওপর ভিত্তি করে প্রণয়ন করা হবে।',
        ],
      },
      books: {
        title: 'বই কোথায় পাবেন',
        text: 'সিলেবাসের বই নিজ উদ্যোগে সংগ্রহ করা যাবে। রেজিস্ট্রেশন ফি দেওয়া প্রত্যেকে একটি বই বিনামূল্যেও পাবেন: পেমেন্টের পর ড্যাশবোর্ডে ডেলিভারির ঠিকানা দিন।',
      },
    },
  },
});
