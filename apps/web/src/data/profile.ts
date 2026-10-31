import {
  normalizeBdMobile,
  PROFILE_LIMITS,
  type ProfileFieldError,
  type ProfileOptions,
  type ProfileUpdate,
  type ProfileUpdateResult,
  type StudentProfile,
} from '@sirat/shared';

/**
 * Validates the profile form against the allow-list (PROFILE_UPDATE_FIELDS: name, phone, district, institution,
 * education type). Only these keys are ever read, so anything else in the form (role, email, grade, category,
 * points...) is dropped here, and the API's DTO refuses it again. The limits are the server's (PROFILE_LIMITS, the
 * registration form's); the server decides. Pure, for node --test and the form.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Students on Bangla keyboards type ০১৭…; the API's normaliser expects Latin digits. */
const toLatinDigits = (value: string) =>
  value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

function length(value: string, limits: { min: number; max: number }): ProfileFieldError | null {
  if (!value) return 'required';
  if (value.length < limits.min) return 'tooShort';
  if (value.length > limits.max) return 'tooLong';
  return null;
}

export function parseProfileForm(
  input: Record<string, unknown>,
  options: Pick<ProfileOptions, 'districts' | 'educationTypes'>,
): { value: ProfileUpdate; result: ProfileUpdateResult } {
  const errors: Partial<Record<keyof ProfileUpdate, ProfileFieldError>> = {};

  const name = text(input.name);
  const nameError = length(name, PROFILE_LIMITS.name);
  if (nameError) errors.name = nameError;

  const phoneRaw = toLatinDigits(text(input.phone));
  const phone = phoneRaw ? normalizeBdMobile(phoneRaw) : null;
  if (!phoneRaw) errors.phone = 'required';
  else if (!phone) errors.phone = 'invalid';

  const district = text(input.district);
  if (!district) errors.district = 'required';
  else if (!options.districts.includes(district)) errors.district = 'invalid';

  const institution = text(input.institution);
  const institutionError = length(institution, PROFILE_LIMITS.institution);
  if (institutionError) errors.institution = institutionError;

  const educationType = text(input.educationType);
  if (!educationType) errors.educationType = 'required';
  else if (!options.educationTypes.includes(educationType)) errors.educationType = 'invalid';

  const value: ProfileUpdate = {
    name,
    phone: phone ?? phoneRaw,
    district,
    institution,
    educationType,
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
 * The select options of the profile form, from the server lists. A stored value that is not in its list (an
 * imported or retired value) is added as one more option. Without it the select would fall back to the empty
 * placeholder and the student would not see what is stored. parseProfileForm still rejects it as 'invalid', so the
 * student replaces it on purpose.
 */
export function profileSelectOptions(
  stored: Pick<StudentProfile, 'educationType' | 'district'>,
  options: ProfileOptions,
): { educationTypes: ProfileSelectOption[]; districts: ProfileSelectOption[] } {
  const withStored = (list: string[], value: string | null) => {
    const items = list.map((item) => ({ value: item, label: item }));
    if (value && !list.includes(value)) items.push({ value, label: value });
    return items;
  };
  return {
    educationTypes: withStored(options.educationTypes, stored.educationType),
    districts: withStored(options.districts, stored.district),
  };
}

/** Everything the client ProfileForm receives, beside its translated text. */
export interface ProfileFormProps {
  initial: Record<keyof Required<ProfileUpdate>, string>;
  email: string;
  gradeLabel: string | null;
  /** The lists the form checks against: strings only. */
  lists: { districts: string[]; educationTypes: string[] };
  educationTypes: ProfileSelectOption[];
  districts: ProfileSelectOption[];
}

/**
 * The client form's props, picked field by field from the server's profile and option lists. A client component's
 * props are serialized into the page (the RSC payload), so passing whole objects would send every field the API
 * ever adds to the browser (the leak check's canaries proved it). Pure, for node --test.
 */
export function toProfileFormProps(
  profile: StudentProfile,
  options: ProfileOptions,
): ProfileFormProps {
  const { educationTypes, districts } = profileSelectOptions(profile, options);
  return {
    initial: {
      name: profile.name,
      phone: profile.phone ?? '',
      district: profile.district ?? '',
      institution: profile.institution ?? '',
      educationType: profile.educationType ?? '',
    },
    email: profile.email,
    gradeLabel: profile.gradeLevel?.label ?? null,
    lists: {
      districts: options.districts.filter((d) => typeof d === 'string'),
      educationTypes: options.educationTypes.filter((t) => typeof t === 'string'),
    },
    educationTypes,
    districts,
  };
}
