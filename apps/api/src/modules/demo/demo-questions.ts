/*
 * The demo question bank: 30 short leadership and general-knowledge questions, each in English and Bangla in one text
 * (the exam room shows one text per question). Four options, keys A-D; plain facts, nothing contested.
 */

export interface DemoQuestion {
  text: string;
  options: [string, string, string, string];
  correct: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  {
    text: 'What is the capital of Bangladesh? / বাংলাদেশের রাজধানী কোনটি?',
    options: ['Chattogram / চট্টগ্রাম', 'Dhaka / ঢাকা', 'Khulna / খুলনা', 'Sylhet / সিলেট'],
    correct: 'B',
    explanation: 'Dhaka is the capital. / ঢাকা রাজধানী।',
  },
  {
    text: 'A good team leader mostly… / একজন ভালো দলনেতা সাধারণত…',
    options: [
      'decides alone / একা সিদ্ধান্ত নেন',
      'listens to the team / দলের কথা শোনেন',
      'avoids all risk / সব ঝুঁকি এড়ান',
      'works only with friends / শুধু বন্ধুদের সাথে কাজ করেন',
    ],
    correct: 'B',
    explanation: 'Listening builds trust. / শোনা আস্থা তৈরি করে।',
  },
  {
    text: 'How many days are there in a leap year? / অধিবর্ষে কত দিন থাকে?',
    options: ['364', '365', '366', '367'],
    correct: 'C',
    explanation: 'A leap year has 366 days. / অধিবর্ষে ৩৬৬ দিন।',
  },
  {
    text: 'Which river is called the Padma in Bangladesh? / বাংলাদেশে কোন নদীকে পদ্মা বলা হয়?',
    options: [
      'Ganges / গঙ্গা',
      'Brahmaputra / ব্রহ্মপুত্র',
      'Teesta / তিস্তা',
      'Karnaphuli / কর্ণফুলী',
    ],
    correct: 'A',
    explanation: 'The Ganges is called the Padma. / গঙ্গার নাম পদ্মা।',
  },
  {
    text: 'Active listening means… / সক্রিয়ভাবে শোনা মানে…',
    options: [
      'waiting to talk / বলার অপেক্ষা',
      'repeating and asking questions / পুনরায় বলা ও প্রশ্ন করা',
      'looking at the phone / ফোনের দিকে তাকানো',
      'interrupting often / বারবার থামানো',
    ],
    correct: 'B',
    explanation: 'It shows you understood. / বোঝা প্রকাশ পায়।',
  },
  {
    text: 'What is 15 % of 200? / ২০০-এর ১৫ % কত?',
    options: ['15', '20', '30', '45'],
    correct: 'C',
    explanation: '200 × 0.15 = 30.',
  },
  {
    text: 'International Mother Language Day is on… / আন্তর্জাতিক মাতৃভাষা দিবস কবে?',
    options: [
      '21 February / ২১ ফেব্রুয়ারি',
      '26 March / ২৬ মার্চ',
      '16 December / ১৬ ডিসেম্বর',
      '14 April / ১৪ এপ্রিল',
    ],
    correct: 'A',
    explanation: '21 February, recognised by UNESCO. / ২১ ফেব্রুয়ারি।',
  },
  {
    text: 'A SMART goal is… / SMART লক্ষ্য হলো…',
    options: [
      'secret and vague / গোপন ও অস্পষ্ট',
      'specific and measurable / নির্দিষ্ট ও পরিমাপযোগ্য',
      'always very large / সবসময় বিশাল',
      'without a deadline / সময়সীমা ছাড়া',
    ],
    correct: 'B',
    explanation: 'Specific, measurable, achievable, relevant, time-bound.',
  },
  {
    text: 'Which planet is closest to the Sun? / সূর্যের সবচেয়ে কাছের গ্রহ কোনটি?',
    options: ['Venus / শুক্র', 'Earth / পৃথিবী', 'Mercury / বুধ', 'Mars / মঙ্গল'],
    correct: 'C',
    explanation: 'Mercury. / বুধ।',
  },
  {
    text: 'When a teammate makes a mistake, a leader should… / সহকর্মী ভুল করলে নেতার উচিত…',
    options: [
      'blame them in public / প্রকাশ্যে দোষ দেওয়া',
      'help them learn from it / শিখতে সাহায্য করা',
      'ignore it forever / চিরকাল উপেক্ষা করা',
      'remove them at once / সঙ্গে সঙ্গে বাদ দেওয়া',
    ],
    correct: 'B',
    explanation: 'Mistakes are for learning. / ভুল থেকে শেখা।',
  },
  {
    text: 'How many divisions does Bangladesh have? / বাংলাদেশে কয়টি বিভাগ আছে?',
    options: ['6', '7', '8', '9'],
    correct: 'C',
    explanation: 'Eight divisions. / আটটি বিভাগ।',
  },
  {
    text: 'What gas do plants take in for photosynthesis? / সালোকসংশ্লেষণে উদ্ভিদ কোন গ্যাস গ্রহণ করে?',
    options: [
      'Oxygen / অক্সিজেন',
      'Carbon dioxide / কার্বন ডাই-অক্সাইড',
      'Nitrogen / নাইট্রোজেন',
      'Hydrogen / হাইড্রোজেন',
    ],
    correct: 'B',
    explanation: 'Carbon dioxide. / কার্বন ডাই-অক্সাইড।',
  },
  {
    text: 'Delegation means… / দায়িত্ব ভাগ করা মানে…',
    options: [
      'doing everything yourself / সব নিজে করা',
      'giving tasks with trust / আস্থা রেখে কাজ দেওয়া',
      'avoiding work / কাজ এড়ানো',
      'giving orders only / শুধু আদেশ দেওয়া',
    ],
    correct: 'B',
    explanation: 'Trusting others with tasks. / অন্যকে দায়িত্ব দেওয়া।',
  },
  {
    text: 'What is 7 × 8? / ৭ × ৮ কত?',
    options: ['54', '56', '58', '64'],
    correct: 'B',
    explanation: '7 × 8 = 56.',
  },
  {
    text: 'Independence Day of Bangladesh is… / বাংলাদেশের স্বাধীনতা দিবস…',
    options: [
      '26 March / ২৬ মার্চ',
      '21 February / ২১ ফেব্রুয়ারি',
      '16 December / ১৬ ডিসেম্বর',
      '1 May / ১ মে',
    ],
    correct: 'A',
    explanation: '26 March. / ২৬ মার্চ।',
  },
  {
    text: 'A good presentation starts with… / একটি ভালো উপস্থাপনা শুরু হয়…',
    options: [
      'a clear purpose / স্পষ্ট উদ্দেশ্য দিয়ে',
      'many small slides / অনেক ছোট স্লাইড দিয়ে',
      'an apology / ক্ষমা চেয়ে',
      'reading every word / প্রতিটি শব্দ পড়ে',
    ],
    correct: 'A',
    explanation: 'Say why it matters. / কেন গুরুত্বপূর্ণ বলুন।',
  },
  {
    text: 'Water boils at sea level at… / সমুদ্রপৃষ্ঠে পানি ফোটে…',
    options: ['50 °C', '90 °C', '100 °C', '120 °C'],
    correct: 'C',
    explanation: '100 °C. / ১০০ °সে।',
  },
  {
    text: 'Which is the largest ocean? / সবচেয়ে বড় মহাসাগর কোনটি?',
    options: ['Atlantic / আটলান্টিক', 'Indian / ভারত', 'Arctic / উত্তর', 'Pacific / প্রশান্ত'],
    correct: 'D',
    explanation: 'The Pacific. / প্রশান্ত মহাসাগর।',
  },
  {
    text: 'Feedback is most useful when it is… / প্রতিক্রিয়া সবচেয়ে কাজের যখন তা…',
    options: [
      'vague / অস্পষ্ট',
      'specific and kind / নির্দিষ্ট ও সদয়',
      'only negative / শুধু নেতিবাচক',
      'given months later / মাস পরে দেওয়া',
    ],
    correct: 'B',
    explanation: 'Specific and kind. / নির্দিষ্ট ও সদয়।',
  },
  {
    text: 'How many minutes are in 2.5 hours? / আড়াই ঘণ্টায় কত মিনিট?',
    options: ['120', '140', '150', '180'],
    correct: 'C',
    explanation: '2.5 × 60 = 150.',
  },
  {
    text: 'The national flower of Bangladesh is… / বাংলাদেশের জাতীয় ফুল…',
    options: ['Rose / গোলাপ', 'Water lily / শাপলা', 'Lotus / পদ্ম', 'Marigold / গাঁদা'],
    correct: 'B',
    explanation: 'The water lily (shapla). / শাপলা।',
  },
  {
    text: 'Time management starts with… / সময় ব্যবস্থাপনা শুরু হয়…',
    options: [
      'setting priorities / অগ্রাধিকার ঠিক করে',
      'sleeping less / কম ঘুমিয়ে',
      'saying yes to all / সবকিছুতে হ্যাঁ বলে',
      'multitasking always / সবসময় একসাথে অনেক কাজ করে',
    ],
    correct: 'A',
    explanation: 'Know what matters first. / কোনটা আগে জানুন।',
  },
  {
    text: 'What is the square root of 81? / ৮১-এর বর্গমূল কত?',
    options: ['7', '8', '9', '10'],
    correct: 'C',
    explanation: '9 × 9 = 81.',
  },
  {
    text: 'Which organ pumps blood? / কোন অঙ্গ রক্ত পাম্প করে?',
    options: ['Lungs / ফুসফুস', 'Liver / যকৃৎ', 'Heart / হৃৎপিণ্ড', 'Kidney / বৃক্ক'],
    correct: 'C',
    explanation: 'The heart. / হৃৎপিণ্ড।',
  },
  {
    text: 'In a conflict, the first step is to… / দ্বন্দ্বে প্রথম পদক্ষেপ হলো…',
    options: [
      'understand each side / প্রত্যেক পক্ষকে বোঝা',
      'pick a winner / একজনকে জয়ী করা',
      'end the team / দল ভেঙে দেওয়া',
      'post online / অনলাইনে লেখা',
    ],
    correct: 'A',
    explanation: 'Understand before solving. / সমাধানের আগে বুঝুন।',
  },
  {
    text: 'How many continents are there? / মহাদেশ কয়টি?',
    options: ['5', '6', '7', '8'],
    correct: 'C',
    explanation: 'Seven continents. / সাতটি মহাদেশ।',
  },
  {
    text: 'Victory Day of Bangladesh is… / বাংলাদেশের বিজয় দিবস…',
    options: [
      '16 December / ১৬ ডিসেম্বর',
      '26 March / ২৬ মার্চ',
      '21 February / ২১ ফেব্রুয়ারি',
      '15 August / ১৫ আগস্ট',
    ],
    correct: 'A',
    explanation: '16 December. / ১৬ ডিসেম্বর।',
  },
  {
    text: 'A volunteer is someone who… / স্বেচ্ছাসেবক তিনি যিনি…',
    options: [
      'works for free to help / বিনা পারিশ্রমিকে সাহায্য করেন',
      'only gives orders / শুধু আদেশ দেন',
      'is paid by the hour / ঘণ্টায় বেতন পান',
      'avoids people / মানুষ এড়িয়ে চলেন',
    ],
    correct: 'A',
    explanation: 'They give time to help. / সময় দিয়ে সাহায্য।',
  },
  {
    text: 'What is 1/4 as a percentage? / ১/৪ শতাংশে কত?',
    options: ['20 %', '25 %', '40 %', '75 %'],
    correct: 'B',
    explanation: '1/4 = 25 %.',
  },
  {
    text: 'Integrity means… / সততা মানে…',
    options: [
      'doing right when no one watches / কেউ না দেখলেও ঠিক কাজ করা',
      'winning at any cost / যেকোনো মূল্যে জেতা',
      'keeping quiet always / সবসময় চুপ থাকা',
      'following the crowd / ভিড়ের পিছনে চলা',
    ],
    correct: 'A',
    explanation: 'Right even unseen. / না দেখলেও ঠিক।',
  },
];
