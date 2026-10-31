/**
 * Registration form constants and error codes shared by the API and the web (docs/plans/PAYMENTS-PLAN.md 6.1).
 * The API refuses anything outside these lists; the web shows them as choices.
 */
import type { PageQuery } from './dashboard';
import type { Category, PaymentStatus } from './index';

/** Bangladesh's 64 districts, in the current official English spelling (8 divisions). */
export const BD_DISTRICTS = [
  // Dhaka (13)
  'Dhaka',
  'Faridpur',
  'Gazipur',
  'Gopalganj',
  'Kishoreganj',
  'Madaripur',
  'Manikganj',
  'Munshiganj',
  'Narayanganj',
  'Narsingdi',
  'Rajbari',
  'Shariatpur',
  'Tangail',
  // Chattogram (11)
  'Bandarban',
  'Brahmanbaria',
  'Chandpur',
  'Chattogram',
  "Cox's Bazar",
  'Cumilla',
  'Feni',
  'Khagrachhari',
  'Lakshmipur',
  'Noakhali',
  'Rangamati',
  // Rajshahi (8)
  'Bogura',
  'Chapai Nawabganj',
  'Joypurhat',
  'Naogaon',
  'Natore',
  'Pabna',
  'Rajshahi',
  'Sirajganj',
  // Khulna (10)
  'Bagerhat',
  'Chuadanga',
  'Jashore',
  'Jhenaidah',
  'Khulna',
  'Kushtia',
  'Magura',
  'Meherpur',
  'Narail',
  'Satkhira',
  // Barishal (6)
  'Barguna',
  'Barishal',
  'Bhola',
  'Jhalokathi',
  'Patuakhali',
  'Pirojpur',
  // Sylhet (4)
  'Habiganj',
  'Moulvibazar',
  'Sunamganj',
  'Sylhet',
  // Rangpur (8)
  'Dinajpur',
  'Gaibandha',
  'Kurigram',
  'Lalmonirhat',
  'Nilphamari',
  'Panchagarh',
  'Rangpur',
  'Thakurgaon',
  // Mymensingh (4)
  'Jamalpur',
  'Mymensingh',
  'Netrokona',
  'Sherpur',
] as const;
export type BdDistrict = (typeof BD_DISTRICTS)[number];

/** The old wizard's education types (owner-approved form, plan Q2). */
export const EDUCATION_TYPES = [
  'Bangla Medium (Bangla & English Version)',
  'English Medium (IGCSE & IB)',
  'Madrasha (Alia & Qawmi)',
  'Higher Education (University and Equivalent)',
  'Vocational, Diploma & Other Technical Education',
] as const;
export type EducationType = (typeof EDUCATION_TYPES)[number];

/** Machine codes in ApiError.code for the registration and payment endpoints; the web maps each to bn/en. */
export const REGISTRATION_ERROR_CODES = [
  'REGISTRATION_CLOSED',
  'PAYMENTS_UNAVAILABLE',
  'PAYMENTS_PAUSED',
  'EMAIL_REGISTERED',
  'EMAIL_IN_PROGRESS',
  'PHONE_REGISTERED',
  'PROMO_INVALID',
  'GRADE_LEVEL_UNKNOWN',
  'START_IN_PROGRESS',
  'START_REQUEST_REUSED',
  'PAYMENT_START_FAILED',
  'TOO_MANY_ATTEMPTS',
  'NO_REGISTRATION',
  'NOTHING_TO_RESUME',
  'RETRY_NOT_ALLOWED',
  'CANNOT_CANCEL',
] as const;
export type RegistrationErrorCode = (typeof REGISTRATION_ERROR_CODES)[number];

/**
 * The owner's texts (DECISIONS 2026-10-31 "Duplicate email and phone at registration", owner, final). Any phone
 * conflict, an account or an attempt in progress, gets the one phone text.
 */
export const REGISTRATION_MESSAGES: Partial<
  Record<RegistrationErrorCode, { bn: string; en: string }>
> = {
  EMAIL_REGISTERED: {
    bn: 'এই email দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অনুগ্রহ করে login করুন।',
    en: 'Already registered. Please log in.',
  },
  PHONE_REGISTERED: {
    bn: 'এই ফোন নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অন্য নম্বর দিন।',
    en: 'This phone number is already registered. Please use another number.',
  },
  PAYMENTS_PAUSED: { bn: 'পেমেন্ট এখন বন্ধ।', en: 'Payments are paused right now.' },
};

/** Where a registration attempt stands, as GET /registrations/current reports it (no personal data). */
export type RegistrationState =
  'awaiting_payment' | 'confirming' | 'completed' | 'failed' | 'expired' | 'needs_help';

// ───────────── API shapes (docs/06-API.md "Registration and payment", "Admin payments and settings") ─────────────

/** The form's limits, as the API's StartRegistrationDto checks them. The web checks the same before it sends. */
export const REGISTRATION_FORM = {
  nameMin: 2,
  nameMax: 100,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 128,
  institutionMin: 2,
  institutionMax: 150,
  promoCodePattern: '^[A-Za-z0-9_-]{3,40}$',
} as const;

/** GET /registrations/info (public, cached 30 s). */
export interface RegistrationInfo {
  open: boolean;
  opensAt: string | null;
  closesAt: string | null;
  fee: { amountMinor: number; currency: string } | null;
  gradeLevels: { id: string; label: string }[];
  districts: string[];
  educationTypes: string[];
}

/** POST /registrations/start. Never an amount, a fee or a role. */
export interface StartRegistrationInput {
  startRequestId: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  district: string;
  institution: string;
  educationType: string;
  gradeLevelId: string;
  promoCode?: string;
}

/** 201 from start and retry: the PayStation checkout to send the browser to. */
export interface StartRegistrationResult {
  paymentUrl: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
}

/** GET /registrations/current: this browser's attempt (the `sirat_reg` cookie). No personal data. */
export interface CurrentRegistration {
  state: RegistrationState;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  expiresAt: string | null;
  canResume: boolean;
  canRetry: boolean;
}

/** GET /registrations/me: the logged-in student's registration and its payment. */
export type MyRegistration =
  | { registered: false }
  | {
      registered: true;
      registeredAt: string;
      category: Category | null;
      gradeLevel: string | null;
      payment: {
        invoiceNumber: string;
        amountMinor: number;
        currency: string;
        status: PaymentStatus;
        paidAt: string | null;
      };
    };

/** Review reasons the settlement and the verify job set on a payment (RUNBOOK §11 says what to do with each). */
export const PAYMENT_REVIEW_REASONS = [
  'success_without_trx_id',
  'email_taken',
  'phone_taken',
  'duplicate_payment',
  'abandoned_attempt_paid',
  'attempt_invalid',
  'amount_mismatch',
  'invoice_mismatch',
  'trx_id_reused',
  'paid_trx_mismatch',
  'refund_reported',
  'late_success',
  'failed_after_paid',
  'manually_reconciled',
] as const;
export type PaymentReviewReason = (typeof PAYMENT_REVIEW_REASONS)[number];

/** GET /admin/payments filters (all exact matches). */
export interface AdminPaymentQuery extends PageQuery {
  invoice?: string;
  trx?: string;
  phone?: string;
  email?: string;
  status?: PaymentStatus;
  review?: boolean;
}

export interface AdminPaymentRow {
  id: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  trxId: string | null;
  paidAmountMinor: number | null;
  gatewayStatus: string | null;
  gatewayAccount: string;
  /** A reason this web does not know yet is shown as its raw text. */
  reviewReason: string | null;
  checkCount: number;
  lastCheckedAt: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  userId: string | null;
  attempt: { status: string; email: string; phone: string; name: string };
}

/** One entry of a payment's log (the stored gateway answer itself stays in the API). */
export interface AdminPaymentEvent {
  id: string;
  source: string;
  outcome: string;
  statusCode: string | null;
  trxStatus: string | null;
  trxId: string | null;
  byAdmin: boolean;
  createdAt: string;
}

export interface AdminPaymentDetail {
  payment: AdminPaymentRow;
  events: AdminPaymentEvent[];
}

/** PUT /admin/settings/:key: the keys an admin may change, and their limits. */
export const ADMIN_SETTING_KEYS = [
  'registration_fee_minor',
  'registration_open',
  'registration_opens_at',
  'registration_closes_at',
  'payment_expiry_minutes',
] as const;
export type AdminSettingKey = (typeof ADMIN_SETTING_KEYS)[number];
export const ADMIN_SETTING_LIMITS = {
  feeMinTaka: 10,
  feeMaxTaka: 10_000,
  reasonMin: 3,
  reasonMax: 200,
  reconcileReasonMin: 10,
  reconcileReasonMax: 200,
} as const;

export interface AdminSetting {
  key: AdminSettingKey;
  value: string | number | boolean | null;
  updatedAt: string;
}
