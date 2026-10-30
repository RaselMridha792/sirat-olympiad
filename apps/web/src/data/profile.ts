import type {
  ProfileFieldError,
  ProfileOptions,
  ProfileUpdate,
  ProfileUpdateResult,
} from '@sirat/shared';

/**
 * Validates the profile form against the allow-list (PROFILE_UPDATE_FIELDS). Only these keys are
 * ever read, so anything else a client posts (role, email, category, points...) is dropped here,
 * and the API's DTO rejects it again. Pure, for node --test and the Server Action.
 */
const LIMITS = { name: 80, district: 60, institution: 120 } as const;
const PHONE = /^(?:\+?88)?01\d{9}$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function parseProfileForm(
  input: Record<string, unknown>,
  options: ProfileOptions,
): { value: ProfileUpdate; result: ProfileUpdateResult } {
  const errors: Partial<Record<keyof ProfileUpdate, ProfileFieldError>> = {};

  const name = text(input.name);
  if (!name) errors.name = 'required';
  else if (name.length > LIMITS.name) errors.name = 'tooLong';

  const phoneRaw = text(input.phone).replace(/[\s-]/g, '');
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
    phone: phoneRaw || null,
    district: district || null,
    institution: institution || null,
    educationType: educationType || null,
    gradeLevelId: gradeLevelId || null,
  };
  const result: ProfileUpdateResult =
    Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true };
  return { value, result };
}
