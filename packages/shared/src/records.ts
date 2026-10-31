import type { AttemptStatus, Category, PaymentStatus, Role } from './index';

/*
 * JSON shapes of the database rows the dashboards read. They MIRROR apps/api/prisma/schema.prisma:
 * same model and field names (Prisma client names), DateTime -> ISO string, Decimal -> number,
 * Json -> a typed shape. Server-only columns (password hashes, gateway payloads, attempt layouts,
 * token hashes) are deliberately absent.
 *
 * RECORD_FIELDS lists every mirrored field with its nullability; the type checks at the bottom keep
 * the interfaces and the list identical, and apps/web/src/data/schema-sync.test.ts fails CI when the
 * list (or an enum below) drifts from schema.prisma.
 */

export const EXAM_STATUSES = ['draft', 'published', 'archived'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const ROUND_TYPES = ['quiz', 'video', 'final'] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export const ENTRY_STATUSES = [
  'pending',
  'submitted',
  'evaluated',
  'promoted',
  'eliminated',
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const TASK_STATUSES = ['assigned', 'submitted', 'approved', 'rejected'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  district: string | null;
  institution: string | null;
  educationType: string | null;
  gradeLevelId: string | null;
  category: Category | null;
  role: Role;
  isBlocked: boolean;
  emailVerifiedAt: string | null;
  referredById: string | null;
  createdAt: string;
}

export interface GradeLevelRecord {
  id: string;
  label: string;
  sortOrder: number;
  category: Category;
}

export interface PaymentRecord {
  id: string;
  userId: string | null;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  trxId: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ExamRecord {
  id: string;
  title: string;
  category: Category | null;
  roundId: string | null;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  questionsPerAttempt: number;
  graceSeconds: number;
  status: ExamStatus;
  resultsPublishedAt: string | null;
  createdAt: string;
}

/** Element of questions.options (Json): [{ "key": "A", "text": "..." }, ...]. */
export interface QuestionOption {
  key: string;
  text: string;
}

/** `correctKey` is admin-only; no student-facing shape may include it. */
export interface QuestionRecord {
  id: string;
  examId: string;
  text: string;
  options: QuestionOption[];
  correctKey: string;
  explanation: string | null;
  version: number;
  isActive: boolean;
}

export interface AttemptRecord {
  id: string;
  userId: string;
  examId: string;
  startedAt: string;
  endsAt: string;
  status: AttemptStatus;
  submittedAt: string | null;
  timeTakenSeconds: number | null;
  score: number | null;
}

export interface RoundRecord {
  id: string;
  name: string;
  sortOrder: number;
  type: RoundType;
  opensAt: string | null;
  closesAt: string | null;
}

export interface RoundEntryRecord {
  id: string;
  userId: string;
  roundId: string;
  status: EntryStatus;
  score: number | null;
  videoUrl: string | null;
}

export interface AmbassadorProfileRecord {
  id: string;
  userId: string;
  promoCode: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface RankThresholdRecord {
  id: string;
  name: string;
  minPoints: number;
}

export interface TeamRecord {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface AdminTaskRecord {
  id: string;
  title: string;
  description: string;
  points: number;
  createdAt: string;
}

export interface TaskAssignmentRecord {
  id: string;
  taskId: string;
  userId: string;
  status: TaskStatus;
  approvedAt: string | null;
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  /** null = everyone */
  category: Category | null;
  publishedAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrored fields per Prisma model: 'req' = NOT NULL, 'opt' = nullable (`?` in schema.prisma). */
export const RECORD_FIELDS = {
  User: {
    id: 'req',
    email: 'req',
    name: 'req',
    phone: 'opt',
    district: 'opt',
    institution: 'opt',
    educationType: 'opt',
    gradeLevelId: 'opt',
    category: 'opt',
    role: 'req',
    isBlocked: 'req',
    emailVerifiedAt: 'opt',
    referredById: 'opt',
    createdAt: 'req',
  },
  GradeLevel: { id: 'req', label: 'req', sortOrder: 'req', category: 'req' },
  Payment: {
    id: 'req',
    userId: 'opt',
    invoiceNumber: 'req',
    amountMinor: 'req',
    currency: 'req',
    status: 'req',
    trxId: 'opt',
    expiresAt: 'req',
    paidAt: 'opt',
    createdAt: 'req',
  },
  Exam: {
    id: 'req',
    title: 'req',
    category: 'opt',
    roundId: 'opt',
    windowStart: 'req',
    windowEnd: 'req',
    durationMinutes: 'req',
    questionsPerAttempt: 'req',
    graceSeconds: 'req',
    status: 'req',
    resultsPublishedAt: 'opt',
    createdAt: 'req',
  },
  Question: {
    id: 'req',
    examId: 'req',
    text: 'req',
    options: 'req',
    correctKey: 'req',
    explanation: 'opt',
    version: 'req',
    isActive: 'req',
  },
  Attempt: {
    id: 'req',
    userId: 'req',
    examId: 'req',
    startedAt: 'req',
    endsAt: 'req',
    status: 'req',
    submittedAt: 'opt',
    timeTakenSeconds: 'opt',
    score: 'opt',
  },
  Round: {
    id: 'req',
    name: 'req',
    sortOrder: 'req',
    type: 'req',
    opensAt: 'opt',
    closesAt: 'opt',
  },
  RoundEntry: {
    id: 'req',
    userId: 'req',
    roundId: 'req',
    status: 'req',
    score: 'opt',
    videoUrl: 'opt',
  },
  AmbassadorProfile: {
    id: 'req',
    userId: 'req',
    promoCode: 'req',
    approvedAt: 'opt',
    createdAt: 'req',
  },
  RankThreshold: { id: 'req', name: 'req', minPoints: 'req' },
  Team: { id: 'req', name: 'req', ownerId: 'req', createdAt: 'req' },
  AdminTask: { id: 'req', title: 'req', description: 'req', points: 'req', createdAt: 'req' },
  TaskAssignment: { id: 'req', taskId: 'req', userId: 'req', status: 'req', approvedAt: 'opt' },
  Announcement: {
    id: 'req',
    title: 'req',
    body: 'req',
    category: 'opt',
    publishedAt: 'req',
    archivedAt: 'opt',
    createdAt: 'req',
    updatedAt: 'req',
  },
} as const;

/** Prisma enums mirrored above and in index.ts, by schema.prisma enum name. */
export const SCHEMA_ENUMS = {
  ExamStatus: EXAM_STATUSES,
  RoundType: ROUND_TYPES,
  EntryStatus: ENTRY_STATUSES,
  TaskStatus: TASK_STATUSES,
} as const;

// ---- compile-time: each interface has exactly the listed fields, with matching nullability ----
type Nullability<T> = { [K in keyof T]-?: null extends T[K] ? 'opt' : 'req' };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Fields = typeof RECORD_FIELDS;
export type RecordMirrorChecks = [
  Assert<Same<Nullability<UserRecord>, Fields['User']>>,
  Assert<Same<Nullability<GradeLevelRecord>, Fields['GradeLevel']>>,
  Assert<Same<Nullability<PaymentRecord>, Fields['Payment']>>,
  Assert<Same<Nullability<ExamRecord>, Fields['Exam']>>,
  Assert<Same<Nullability<QuestionRecord>, Fields['Question']>>,
  Assert<Same<Nullability<AttemptRecord>, Fields['Attempt']>>,
  Assert<Same<Nullability<RoundRecord>, Fields['Round']>>,
  Assert<Same<Nullability<RoundEntryRecord>, Fields['RoundEntry']>>,
  Assert<Same<Nullability<AmbassadorProfileRecord>, Fields['AmbassadorProfile']>>,
  Assert<Same<Nullability<RankThresholdRecord>, Fields['RankThreshold']>>,
  Assert<Same<Nullability<TeamRecord>, Fields['Team']>>,
  Assert<Same<Nullability<AdminTaskRecord>, Fields['AdminTask']>>,
  Assert<Same<Nullability<TaskAssignmentRecord>, Fields['TaskAssignment']>>,
  Assert<Same<Nullability<AnnouncementRecord>, Fields['Announcement']>>,
];
