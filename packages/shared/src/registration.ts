/**
 * Registration form constants and error codes shared by the API and the web (docs/plans/PAYMENTS-PLAN.md 6.1).
 * The API refuses anything outside these lists; the web shows them as choices.
 */

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
