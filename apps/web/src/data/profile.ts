import type {
  ProfileFieldError,
  ProfileOptions,
  ProfileUpdate,
  ProfileUpdateResult,
  StudentProfile,
} from '@sirat/shared';

/**
 * Validates the profile form against the allow-list (PROFILE_UPDATE_FIELDS). Only these keys are
 * ever read, so anything else a client posts (role, email, category, points...) is dropped here,
 * and the API's DTO rejects it again. Pure, for node --test and the Server Action.
 */
const LIMITS = { name: 80, district: 60, institution: 120 } as const;
const PHONE = /^(?:\+?88)?01\d{9}$/;
/** The optional country code. Dropped after validation, so every number is stored as 01XXXXXXXXX. */
const COUNTRY_CODE = /^\+?88(?=01)/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Students on Bangla keyboards type ০১৭…; store Latin digits. */
const toLatinDigits = (value: string) =>
  value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

export function parseProfileForm(
  input: Record<string, unknown>,
  options: ProfileOptions,
): { value: ProfileUpdate; result: ProfileUpdateResult } {
  const errors: Partial<Record<keyof ProfileUpdate, ProfileFieldError>> = {};

  const name = text(input.name);
  if (!name) errors.name = 'required';
  else if (name.length > LIMITS.name) errors.name = 'tooLong';

  const phoneRaw = toLatinDigits(text(input.phone)).replace(/[\s-]/g, '');
  if (phoneRaw && !PHONE.test(phoneRaw)) errors.phone = 'invalid';

  const district = text(input.district);
  if (district.length > LIMITS.district) errors.district = 'tooLong';

  const institution = text(input.institution);
  if (institution.length > LIMITS.institution) errors.institution = 'tooLong';

  const educationType = text(input.educationType);
  if (educationType && !options.educationTypes.includes(educationType)) {
    errors.educationType = 'invalid';
  }

  const gradeLevelId = text(input.gradeLevelId);
  if (gradeLevelId && !options.gradeLevels.some((g) => g.id === gradeLevelId)) {
    errors.gradeLevelId = 'invalid';
  }

  const value: ProfileUpdate = {
    name,
    phone: phoneRaw ? phoneRaw.replace(COUNTRY_CODE, '') : null,
    district: district || null,
    institution: institution || null,
    educationType: educationType || null,
    gradeLevelId: gradeLevelId || null,
  };
  const result: ProfileUpdateResult =
    Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true };
  return { value, result };
}

export interface ProfileSelectOption {
  value: string;
  label: string;
}

/**
 * The select options of the profile form, from the server lists. A stored value that is not in
 * its list (a retired education type, an imported grade) is added as one more option. Without it
 * the select would fall back to the empty placeholder, and saving any other change would wipe the
 * stored value. parseProfileForm still rejects it as 'invalid', so the student replaces it on
 * purpose.
 */
export function profileSelectOptions(
  stored: Pick<StudentProfile, 'educationType' | 'gradeLevel'>,
  options: ProfileOptions,
): { educationTypes: ProfileSelectOption[]; gradeLevels: ProfileSelectOption[] } {
  const educationTypes = options.educationTypes.map((type) => ({ value: type, label: type }));
  const type = stored.educationType;
  if (type && !options.educationTypes.includes(type)) {
    educationTypes.push({ value: type, label: type });
  }

  const gradeLevels = options.gradeLevels.map((g) => ({ value: g.id, label: g.label }));
  const grade = stored.gradeLevel;
  if (grade && !options.gradeLevels.some((g) => g.id === grade.id)) {
    gradeLevels.push({ value: grade.id, label: grade.label });
  }

  return { educationTypes, gradeLevels };
}
