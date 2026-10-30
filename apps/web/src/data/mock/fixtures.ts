import type {
  AdminTaskRecord,
  AnnouncementRecord,
  AttemptStatus,
  Category,
  EntryStatus,
  ExamRecord,
  GradeLevelRecord,
  PaymentRecord,
  QuestionRecord,
  RankThresholdRecord,
  Role,
  RoundRecord,
  TaskStatus,
  UserRecord,
} from '@sirat/shared';
import { createRandom } from './random.ts';

/*
 * DEV-ONLY MOCK WORLD. Typed with the schema mirrors from @sirat/shared, so a schema change breaks
 * this file at compile time instead of drifting. Everything is fictional: names are combinations
 * of common first and last names, institutions are invented, emails use example.com and phone
 * numbers use the unallocated 010 prefix. Never move this into public/ (RULEBOOK §18).
 *
 * Story: Round 1 (quiz) is over and its leaderboard is published; the demo student was promoted
 * and is now in Round 2 (video); Round 3 has no results yet.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Same labels, order and category bands as the reference-data migration. */
export const GRADE_LEVELS: GradeLevelRecord[] = (
  [
    ['Class 5 / PYP 5 / Taisir', 'activist'],
    ['Class 6 / MYP 1 / Mizan', 'activist'],
    ['Class 7 / MYP 2 / Nahbemir', 'activist'],
    ['Class 8 / MYP 3 / Hidayatunnah', 'activist'],
    ['Class 9 / MYP 4 / Kafiya & Bekaya', 'ambassador'],
    ['Class 10 / MYP 5', 'ambassador'],
    ['SSC / O Level / Dakhil Candidate', 'ambassador'],
    ['Class 11 / DP 1 / Jalalayn', 'ambassador'],
    ['Class 12 / DP 2', 'ambassador'],
    ['HSC / A Level / Alim Candidate', 'ambassador'],
    ['University Admission Candidate / Musannif', 'achiever'],
    ['University 1st Year / Diploma 1st Year / Fazil / Mishkat', 'achiever'],
    ['University 2nd Year / Diploma 2nd Year', 'achiever'],
    ['University 3rd Year / Diploma 3rd Year', 'achiever'],
    ['University 4th Year / Diploma 4th Year', 'achiever'],
    ['University 5th Year & Intern / Kamil / Dawrah', 'achiever'],
    ['Postgraduate (Masters) and Above', 'achiever'],
  ] as const
).map(([label, category], index) => ({
  id: `gl-${String(index + 1).padStart(2, '0')}`,
  label,
  sortOrder: index + 1,
  category,
}));

export const EDUCATION_TYPES = [
  'Bangla Medium (Bangla & English Version)',
  'English Medium (IGCSE & IB)',
  'Madrasha (Alia & Qawmi)',
  'Higher Education (University and Equivalent)',
  'Vocational, Diploma & Other Technical Education',
];

export const RANKS: RankThresholdRecord[] = [
  { id: 'rk-bronze', name: 'Bronze', minPoints: 0 },
  { id: 'rk-silver', name: 'Silver', minPoints: 100 },
  { id: 'rk-gold', name: 'Gold', minPoints: 250 },
];

const FIRST_NAMES = [
  'Nafis',
  'Tahsin',
  'Ayesha',
  'Fatima',
  'Rahim',
  'Nusrat',
  'Sadia',
  'Tanvir',
  'Arif',
  'Mehjabin',
  'Raisa',
  'Farhan',
  'Zarif',
  'Ishrat',
  'Tasnim',
  'Sabbir',
  'Rafi',
  'Maliha',
  'Jannat',
  'Siam',
  'Anika',
  'Imran',
  'Mahir',
  'Labiba',
  'Rifat',
  'Samira',
  'Ahnaf',
  'Nabila',
  'Shuvo',
  'Tamim',
];
const LAST_NAMES = [
  'Ahmed',
  'Hossain',
  'Rahman',
  'Islam',
  'Chowdhury',
  'Khan',
  'Akter',
  'Sarkar',
  'Das',
  'Roy',
  'Uddin',
  'Karim',
  'Talukder',
  'Siddique',
  'Haque',
  'Kabir',
  'Biswas',
  'Saha',
  'Mahmud',
  'Alam',
];
/** Some users type their name in Bangla; the UI must render and search those too. */
const BANGLA_NAMES = [
  'তাহসিন রহমান',
  'আয়েশা সিদ্দিকা',
  'ফারহান হোসেন',
  'নুসরাত জাহান',
  'সাব্বির আহমেদ',
  'মালিহা ইসলাম',
  'রাফি চৌধুরী',
  'জান্নাতুল ফেরদৌস',
];
const INSTITUTIONS = [
  'Padma Model School',
  'Meghna Public College',
  'Jamuna Residential School',
  'Karnaphuli Academy',
  'Surma Girls’ High School',
  'Teesta Science College',
  'Rupsha Ideal School',
  'Dhaleshwari Madrasha',
  'Shitalakshya Grammar School',
  'Buriganga Collegiate School',
  'North River University',
  'Shapla University of Science',
  'Kapotaksha Polytechnic Institute',
  'Madhumati Alim Madrasha',
];
const DISTRICTS = [
  'Dhaka',
  'Chattogram',
  'Sylhet',
  'Rajshahi',
  'Khulna',
  'Barishal',
  'Rangpur',
  'Mymensingh',
  'Cumilla',
  'Gazipur',
  'Narayanganj',
  'Bogura',
  'Jashore',
  'Cox’s Bazar',
  'Tangail',
  'Feni',
];

export interface MockUser extends UserRecord {
  payment: Pick<
    PaymentRecord,
    'status' | 'invoiceNumber' | 'amountMinor' | 'currency' | 'paidAt'
  > | null;
}

export interface MockExam extends ExamRecord {
  questions: QuestionRecord[];
  /** The demo student's attempt, if any (drives the student's exam state). */
  myAttempt: AttemptStatus | null;
}

export interface MockStanding {
  user: MockUser;
  score: number;
  timeTakenSeconds: number | null;
  entryStatus: EntryStatus;
  rank: number;
}

export interface MockAmbassador {
  user: MockUser;
  promoCode: string;
  approvedAt: string | null;
  createdAt: string;
  referralCount: number;
  points: number;
}

export interface MockWorld {
  now: number;
  me: MockUser;
  users: MockUser[];
  rounds: RoundRecord[];
  currentRoundId: string;
  exams: MockExam[];
  announcements: AnnouncementRecord[];
  standings: Map<string, MockStanding[]>;
  leaderboardPublic: boolean;
  snapshotAt: string;
  ambassadors: MockAmbassador[];
  team: { id: string; name: string; memberCount: number };
  tasks: Array<AdminTaskRecord & { status: TaskStatus }>;
  registrationsDaily: Array<{ date: string; count: number }>;
  activeAttempts: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const dhakaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });

const QUESTION_BANK: Array<
  [string, [string, string, string, string], 'A' | 'B' | 'C' | 'D', string]
> = [
  [
    'What is the main job of a team leader during a group project?',
    [
      'Do all the work alone',
      'Help the team agree on goals and share the tasks',
      'Avoid making decisions',
      'Only report results to the teacher',
    ],
    'B',
    'Leaders align the team and spread the work; they do not carry it alone.',
  ],
  [
    'Active listening means…',
    [
      'Waiting for your turn to speak',
      'Giving full attention and checking that you understood',
      'Interrupting with solutions',
      'Only taking notes',
    ],
    'B',
    'Listening is about understanding, then confirming it.',
  ],
  [
    'A good way to handle a disagreement in your team is to…',
    [
      'Ignore it',
      'Vote at once without discussion',
      'Let each person explain, then look for common ground',
      'Let the loudest person decide',
    ],
    'C',
    'Hearing every side first turns conflict into better decisions.',
  ],
  [
    'Which of these is an example of servant leadership?',
    [
      'Giving orders without explanation',
      'Putting the team’s needs first and removing obstacles',
      'Taking credit for the team’s success',
      'Avoiding responsibility',
    ],
    'B',
    'Servant leaders serve the team so the team can succeed.',
  ],
  [
    'SMART goals are…',
    [
      'Specific, Measurable, Achievable, Relevant, Time-bound',
      'Simple, Modern, Accurate, Rapid, Tested',
      'Strong, Motivated, Ambitious, Ready, Tough',
      'Shared, Managed, Approved, Reviewed, Tracked',
    ],
    'A',
    'SMART is a checklist for goals you can actually reach and measure.',
  ],
  [
    'Integrity in leadership means…',
    [
      'Doing what is right even when no one is watching',
      'Always agreeing with the majority',
      'Never changing your mind',
      'Keeping all information secret',
    ],
    'A',
    'Integrity is consistency between values and actions.',
  ],
  [
    'When a project fails, a responsible leader should first…',
    [
      'Blame the team',
      'Hide the result',
      'Review what happened and share the lessons',
      'Quit the project',
    ],
    'C',
    'Owning the result and learning from it builds trust.',
  ],
  [
    'Delegation helps a team because it…',
    [
      'Removes all responsibility from the leader',
      'Builds skills and spreads the workload',
      'Replaces planning',
      'Makes meetings longer',
    ],
    'B',
    'Good delegation grows people and gets more done.',
  ],
  [
    'Which action best shows empathy?',
    [
      'Understanding how others feel and responding with care',
      'Telling people to stop complaining',
      'Fixing problems without asking',
      'Changing the subject',
    ],
    'A',
    'Empathy starts with understanding feelings, not with fixing.',
  ],
  [
    'A community volunteer project is most successful when…',
    [
      'Only the leader decides',
      'The community’s real needs are understood first',
      'It is finished as fast as possible',
      'It copies another project exactly',
    ],
    'B',
    'Projects that start from real needs make real change.',
  ],
];

function questionsFor(examId: string): QuestionRecord[] {
  return QUESTION_BANK.map(([text, options, correctKey, explanation], index) => ({
    id: `${examId}-q${index + 1}`,
    examId,
    text,
    options: options.map((option, i) => ({ key: 'ABCD'[i] ?? '?', text: option })),
    correctKey,
    explanation,
    version: index === 2 ? 2 : 1,
    isActive: true,
  }));
}

function buildWorld(now: number): MockWorld {
  const rnd = createRandom(20261030);

  const rounds: RoundRecord[] = [
    {
      id: 'rd-1',
      name: 'Round 1',
      sortOrder: 1,
      type: 'quiz',
      opensAt: iso(now - 14 * DAY),
      closesAt: iso(now - 10 * DAY),
    },
    {
      id: 'rd-2',
      name: 'Round 2',
      sortOrder: 2,
      type: 'video',
      opensAt: iso(now - 2 * DAY),
      closesAt: iso(now + 12 * DAY),
    },
    {
      id: 'rd-3',
      name: 'Grand Finale',
      sortOrder: 3,
      type: 'final',
      opensAt: null,
      closesAt: null,
    },
  ];

  const roleFor = (index: number): Role =>
    index < 2
      ? 'admin'
      : index < 4
        ? 'manager'
        : index < 7
          ? 'jury'
          : index < 66
            ? 'ambassador'
            : 'student';

  const makeUser = (index: number): MockUser => {
    const bangla = rnd.chance(0.08);
    const first = rnd.pick(FIRST_NAMES);
    const last = rnd.pick(LAST_NAMES);
    const name = bangla ? rnd.pick(BANGLA_NAMES) : `${first} ${last}`;
    const grade = rnd.pick(GRADE_LEVELS);
    const createdAt = now - rnd.int(1, 120) * DAY - rnd.int(0, 23) * HOUR;
    const paid = rnd.chance(0.86);
    const pending = !paid && rnd.chance(0.25);
    const invoice = `SLO-${String(100000 + index)}`;
    return {
      id: rnd.id('usr'),
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${index}@example.com`,
      name,
      phone: rnd.chance(0.85) ? `010${String(rnd.int(0, 99_999_999)).padStart(8, '0')}` : null,
      district: rnd.chance(0.9) ? rnd.pick(DISTRICTS) : null,
      institution: rnd.chance(0.93) ? rnd.pick(INSTITUTIONS) : null,
      educationType: rnd.pick(EDUCATION_TYPES),
      gradeLevelId: grade.id,
      category: grade.category,
      role: roleFor(index),
      isBlocked: rnd.chance(0.02),
      emailVerifiedAt: rnd.chance(0.9) ? iso(createdAt + HOUR) : null,
      referredById: null,
      createdAt: iso(createdAt),
      payment:
        paid || pending
          ? {
              status: paid ? 'paid' : 'pending',
              invoiceNumber: invoice,
              amountMinor: 50000,
              currency: 'BDT',
              paidAt: paid ? iso(createdAt + 20 * 60_000) : null,
            }
          : rnd.chance(0.3)
            ? {
                status: 'failed',
                invoiceNumber: invoice,
                amountMinor: 50000,
                currency: 'BDT',
                paidAt: null,
              }
            : null,
    };
  };

  const me: MockUser = {
    id: 'usr-demo-student',
    email: 'nafis.ahmed@example.com',
    name: 'Nafis Ahmed',
    phone: '01000000123',
    district: 'Dhaka',
    institution: 'Padma Model School',
    educationType: EDUCATION_TYPES[0] ?? null,
    gradeLevelId: 'gl-06',
    category: 'ambassador',
    role: 'ambassador',
    isBlocked: false,
    emailVerifiedAt: iso(now - 60 * DAY),
    referredById: null,
    createdAt: iso(now - 61 * DAY),
    payment: {
      status: 'paid',
      invoiceNumber: 'SLO-099999',
      amountMinor: 50000,
      currency: 'BDT',
      paidAt: iso(now - 61 * DAY),
    },
  };

  const others = Array.from({ length: 2399 }, (_, i) => makeUser(i));
  // 37 students joined with the demo ambassador's code (referral counts come from rows, not a counter).
  others
    .filter((u) => u.role === 'student')
    .slice(0, 37)
    .forEach((u) => {
      u.referredById = me.id;
    });
  const users = [me, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Round 1 standings: score DESC, time ASC; equal score and time share a rank (1, 2, 2, 4).
  const participants = [
    me,
    ...others.filter((u) => u.role === 'student' || u.role === 'ambassador'),
  ].slice(0, 1200);
  const raw = participants.map((user) => ({
    user,
    score:
      user === me
        ? 92
        : Math.min(
            100,
            Math.max(12, Math.round(55 + (rnd.next() + rnd.next() + rnd.next() - 1.5) * 40)),
          ),
    timeTakenSeconds: user === me ? 1104 : rnd.int(420, 1800),
  }));
  raw.sort((a, b) => b.score - a.score || a.timeTakenSeconds - b.timeTakenSeconds);
  const round1: MockStanding[] = [];
  raw.forEach((row, index) => {
    const prev = round1[index - 1];
    const tied = prev && prev.score === row.score && prev.timeTakenSeconds === row.timeTakenSeconds;
    round1.push({
      ...row,
      rank: tied ? prev.rank : index + 1,
      entryStatus: index < 300 ? 'promoted' : 'evaluated',
    });
  });

  const standings = new Map<string, MockStanding[]>([['rd-1', round1]]);

  const exam = (
    id: string,
    title: string,
    category: Category | null,
    roundId: string | null,
    startOffset: number,
    endOffset: number,
    durationMinutes: number,
    status: ExamRecord['status'],
    myAttempt: AttemptStatus | null,
  ): MockExam => ({
    id,
    title,
    category,
    roundId,
    windowStart: iso(now + startOffset),
    windowEnd: iso(now + endOffset),
    durationMinutes,
    questionsPerAttempt: 10,
    graceSeconds: 30,
    status,
    resultsPublishedAt:
      endOffset < -9 * DAY && status !== 'draft' ? iso(now + endOffset + DAY) : null,
    createdAt: iso(now + startOffset - 7 * DAY),
    questions: questionsFor(id),
    myAttempt,
  });

  const exams: MockExam[] = [
    exam(
      'ex-practice',
      'Practice Quiz: Leadership Basics',
      null,
      null,
      -2 * HOUR,
      2 * DAY,
      15,
      'published',
      null,
    ),
    exam(
      'ex-r2-check',
      'Round 2 Knowledge Check',
      'ambassador',
      'rd-2',
      3 * DAY,
      4 * DAY,
      20,
      'published',
      null,
    ),
    exam(
      'ex-r1-amb',
      'Round 1 Quiz — Ambassador',
      'ambassador',
      'rd-1',
      -14 * DAY,
      -10 * DAY,
      30,
      'published',
      'scored',
    ),
    exam(
      'ex-orientation',
      'Orientation Quiz',
      null,
      null,
      -30 * DAY,
      -28 * DAY,
      10,
      'archived',
      null,
    ),
    exam(
      'ex-r1-act',
      'Round 1 Quiz — Activist',
      'activist',
      'rd-1',
      -14 * DAY,
      -10 * DAY,
      30,
      'published',
      null,
    ),
    exam(
      'ex-r1-ach',
      'Round 1 Quiz — Achiever',
      'achiever',
      'rd-1',
      -14 * DAY,
      -10 * DAY,
      30,
      'published',
      null,
    ),
    exam(
      'ex-r2-act',
      'Round 2 Knowledge Check — Activist',
      'activist',
      'rd-2',
      3 * DAY,
      4 * DAY,
      20,
      'draft',
      null,
    ),
  ];

  const announcement = (
    id: string,
    title: string,
    body: string,
    daysAgo: number,
  ): AnnouncementRecord => ({
    id,
    title,
    body,
    publishedAt: iso(now - daysAgo * DAY),
    createdAt: iso(now - daysAgo * DAY - HOUR),
  });
  const announcements: AnnouncementRecord[] = [
    announcement(
      'an-1',
      'Round 2 video submissions are open',
      'Promoted students can submit one video link until the Round 2 deadline. You can update your link until the window closes.',
      1,
    ),
    announcement(
      'an-2',
      'Practice quiz is live',
      'Try the practice quiz to get used to the exam screen. It does not count towards your result.',
      2,
    ),
    announcement(
      'an-3',
      'পরীক্ষার আগে যা দেখে নেবেন',
      'পরীক্ষার আগে ইন্টারনেট সংযোগ দেখে নিন। সংযোগ চলে গেলেও আপনার উত্তর ডিভাইসে সংরক্ষিত থাকে, সংযোগ ফিরলে আবার পাঠানো হয়।',
      4,
    ),
    announcement(
      'an-4',
      'Round 1 leaderboard published',
      'The Round 1 results are on the leaderboard. Ties on score and time share the same rank.',
      9,
    ),
    announcement(
      'an-5',
      'Check your profile',
      'Please make sure your institution and grade are correct. Your category depends on your grade level.',
      15,
    ),
    announcement(
      'an-6',
      'Help desk hours',
      'Our help desk answers messages from 10 AM to 6 PM, Saturday to Thursday.',
      21,
    ),
    announcement(
      'an-7',
      'Ambassador tasks for this month',
      'Ambassadors can find this month’s tasks in the Ambassador Panel. Points are added after review.',
      25,
    ),
    announcement(
      'an-8',
      'Welcome to the Sirat Leadership Olympiad',
      'Thank you for registering. Watch this space for schedules and results.',
      40,
    ),
  ];

  const ambassadorUsers = [me, ...others.filter((u) => u.role === 'ambassador')];
  const ambassadors: MockAmbassador[] = ambassadorUsers.map((user, index) => {
    const referralCount =
      user === me ? others.filter((u) => u.referredById === me.id).length : rnd.int(0, 60);
    const base = /^[A-Za-z]+/.exec(user.name)?.[0]?.toUpperCase() ?? 'AMB';
    return {
      user,
      promoCode: user === me ? 'NAFIS24' : `${base.slice(0, 6)}${String(index + 10)}`,
      approvedAt: user === me || rnd.chance(0.85) ? iso(now - rnd.int(5, 60) * DAY) : null,
      createdAt: iso(now - rnd.int(20, 90) * DAY),
      referralCount,
      points: referralCount * 5 + (user === me ? 0 : rnd.int(0, 120)),
    };
  });

  const registrationsDaily = Array.from({ length: 45 }, (_, i) => {
    const day = 44 - i;
    const trend = 18 + (44 - day) * 0.9;
    const weekend = new Date(now - day * DAY).getUTCDay() === 5 ? 0.6 : 1; // Friday dip
    const deadlineRush = day < 4 ? 1.8 : 1;
    return {
      date: dhakaDay.format(new Date(now - day * DAY)),
      count: Math.round(trend * weekend * deadlineRush + rnd.int(-6, 6)),
    };
  });

  return {
    now,
    me,
    users,
    rounds,
    currentRoundId: 'rd-2',
    exams,
    announcements,
    standings,
    leaderboardPublic: true,
    snapshotAt: iso(now - 9 * DAY),
    ambassadors,
    team: { id: 'tm-padma', name: 'Padma Changemakers', memberCount: 6 },
    tasks: [
      {
        id: 'tk-1',
        title: 'Share the registration link in your school group',
        description: 'Post the official link with your promo code in one school or class group.',
        points: 20,
        createdAt: iso(now - 20 * DAY),
        status: 'approved',
      },
      {
        id: 'tk-2',
        title: 'Hold a 15-minute info session for your class',
        description:
          'Explain the rounds and the rules, then send a photo or the attendance list as proof.',
        points: 40,
        createdAt: iso(now - 12 * DAY),
        status: 'submitted',
      },
      {
        id: 'tk-3',
        title: 'Collect feedback from five participants',
        description:
          'Ask five registered students what was hard during Round 1 and submit their answers.',
        points: 30,
        createdAt: iso(now - 6 * DAY),
        status: 'assigned',
      },
      {
        id: 'tk-4',
        title: 'Design a poster for leadership week',
        description: 'A4 poster with the Olympiad dates. Use the brand colours.',
        points: 25,
        createdAt: iso(now - 30 * DAY),
        status: 'rejected',
      },
    ],
    registrationsDaily,
    activeAttempts: 142,
  };
}

let world: MockWorld | null = null;

/** Built once per server process (dev only). */
export function getWorld(): MockWorld {
  world ??= buildWorld(Date.now());
  return world;
}
