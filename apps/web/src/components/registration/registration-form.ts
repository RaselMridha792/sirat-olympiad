import { normalizeBdMobile, REGISTRATION_FORM, type StartRegistrationInput } from '@sirat/shared';
import type { RegistrationMessages } from '../../i18n/messages/registration.ts';

/*
 * The registration form's rules, the same as the API's StartRegistrationDto checks (06-API "Registration and
 * payment"), so a student sees a mistake on the step where it is, before anything is sent. The server checks
 * everything again; the common-password list is only on the server. Pure, for node --test.
 */

export interface FormValues {
  name: string;
  phone: string;
  email: string;
  password: string;
  district: string;
  institution: string;
  educationType: string;
  gradeLevelId: string;
  promoCode: string;
}
export type FieldKey = keyof FormValues;
export type InvalidKey = keyof RegistrationMessages['invalid'];
export type FieldErrors = Partial<Record<FieldKey, InvalidKey>>;

export const STEPS = ['you', 'school', 'review'] as const;
export type StepKey = (typeof STEPS)[number];

/** Which fields each input step holds; the review step holds none. */
export const STEP_FIELDS: Record<StepKey, readonly FieldKey[]> = {
  you: ['name', 'phone', 'email', 'password'],
  school: ['district', 'institution', 'educationType', 'gradeLevelId', 'promoCode'],
  review: [],
};

export const EMPTY_FORM: FormValues = {
  name: '',
  phone: '',
  email: '',
  password: '',
  district: '',
  institution: '',
  educationType: '',
  gradeLevelId: '',
  promoCode: '',
};

/** The choices the form offers (from GET /registrations/info). */
export interface FormChoices {
  districts: readonly string[];
  educationTypes: readonly string[];
  gradeLevelIds: readonly string[];
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');
// The API uses class-validator's IsEmail; this simpler check only catches typing mistakes before sending.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROMO = new RegExp(REGISTRATION_FORM.promoCodePattern);

function check(field: FieldKey, v: FormValues, choices: FormChoices): InvalidKey | null {
  const f = REGISTRATION_FORM;
  switch (field) {
    case 'name': {
      const name = squash(v.name);
      if (!name) return 'required';
      return name.length < f.nameMin || name.length > f.nameMax ? 'name' : null;
    }
    case 'phone':
      if (!v.phone.trim()) return 'required';
      return normalizeBdMobile(v.phone) ? null : 'phone';
    case 'email': {
      const email = v.email.trim();
      if (!email) return 'required';
      return email.length <= f.emailMax && EMAIL.test(email) ? null : 'email';
    }
    case 'password':
      if (!v.password) return 'required';
      if (v.password.length < f.passwordMin) return 'passwordShort';
      return v.password.length > f.passwordMax ? 'passwordLong' : null;
    case 'district':
      return choices.districts.includes(v.district) ? null : 'choose';
    case 'institution': {
      const institution = squash(v.institution);
      if (!institution) return 'required';
      return institution.length < f.institutionMin || institution.length > f.institutionMax
        ? 'institution'
        : null;
    }
    case 'educationType':
      return choices.educationTypes.includes(v.educationType) ? null : 'choose';
    case 'gradeLevelId':
      return choices.gradeLevelIds.includes(v.gradeLevelId) ? null : 'choose';
    case 'promoCode': {
      const code = v.promoCode.trim();
      return code === '' || PROMO.test(code) ? null : 'promoCode';
    }
  }
}

export function validateStep(step: StepKey, values: FormValues, choices: FormChoices): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of STEP_FIELDS[step]) {
    const problem = check(field, values, choices);
    if (problem) errors[field] = problem;
  }
  return errors;
}

/** The first step that has a field in `errors` (where the wizard goes back to). */
export function stepOf(field: FieldKey): StepKey {
  return STEP_FIELDS.you.includes(field) ? 'you' : 'school';
}

/** What POST /registrations/start receives: trimmed, the phone as 01XXXXXXXXX, the email lowercased, no empty promo. */
export function toStartInput(values: FormValues, startRequestId: string): StartRegistrationInput {
  const promoCode = values.promoCode.trim();
  return {
    startRequestId,
    name: squash(values.name),
    phone: normalizeBdMobile(values.phone) ?? values.phone.trim(),
    email: values.email.trim().toLowerCase(),
    password: values.password,
    district: values.district,
    institution: squash(values.institution),
    educationType: values.educationType,
    gradeLevelId: values.gradeLevelId,
    ...(promoCode ? { promoCode } : {}),
  };
}
