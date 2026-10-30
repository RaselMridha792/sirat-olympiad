'use client';
import { useActionState, useEffect, useRef } from 'react';
import type { ProfileFieldError, ProfileUpdate } from '@sirat/shared';
import { Button, Field, SelectField, type SelectOption } from '@sirat/ui';

/** The allow-listed fields (PROFILE_UPDATE_FIELDS). role, email and category are never in the form. */
export type ProfileField = keyof ProfileUpdate;
export type ProfileFormValues = Record<ProfileField, string>;

/** What the Server Action returns. `{}` before the first submit; a success redirects instead. */
export interface ProfileFormState {
  /**
   * The values the user sent, echoed back on failure. React resets a form after its action
   * finishes, so the fields render these as their defaults to keep what the user typed.
   */
  values?: ProfileFormValues;
  fieldErrors?: Partial<Record<ProfileField, ProfileFieldError>>;
  /** Unexpected failure (network, server). Never carries the raw error. */
  formError?: boolean;
}

export type ProfileFormAction = (
  state: ProfileFormState,
  formData: FormData,
) => Promise<ProfileFormState>;

/** Translated strings, resolved on the server (plain strings only, no functions). */
export interface ProfileFormText {
  personal: string;
  academic: string;
  name: string;
  email: string;
  emailNote: string;
  phone: string;
  phoneHint: string;
  district: string;
  institution: string;
  educationType: string;
  educationTypePlaceholder: string;
  gradeLevel: string;
  gradeLevelPlaceholder: string;
  gradeLevelHint: string;
  submit: string;
  saving: string;
  formError: string;
  checkFields: string;
  /** Fallback text per error code. */
  errors: Record<ProfileFieldError, string>;
  /** Field-specific text, where it says more than the fallback. */
  fieldErrors: Partial<Record<ProfileField, Partial<Record<ProfileFieldError, string>>>>;
}

const INITIAL_STATE: ProfileFormState = {};

export function ProfileForm({
  action,
  initial,
  email,
  educationTypes,
  gradeLevels,
  text,
}: {
  /** Server Action (serializable by reference). */
  action: ProfileFormAction;
  initial: ProfileFormValues;
  email: string;
  educationTypes: SelectOption[];
  gradeLevels: SelectOption[];
  text: ProfileFormText;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const values = state.values ?? initial;
  const fieldErrors = state.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const errorFor = (field: ProfileField): string | undefined => {
    const code = fieldErrors[field];
    return code ? (text.fieldErrors[field]?.[code] ?? text.errors[code]) : undefined;
  };

  // After a failed save, move focus to the first field that needs fixing.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-8">
      <fieldset>
        <legend className="mb-4 text-lg font-bold text-ink">{text.personal}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            id="profile-name"
            name="name"
            label={text.name}
            required
            autoComplete="name"
            defaultValue={values.name}
            error={errorFor('name')}
          />
          <dl className="space-y-1.5">
            <dt className="text-sm font-semibold text-ink">{text.email}</dt>
            <dd className="break-all rounded-control border border-line bg-page px-4 py-3 text-ink-muted">
              {email}
            </dd>
            <dd className="text-xs text-ink-faint">{text.emailNote}</dd>
          </dl>
          <Field
            id="profile-phone"
            name="phone"
            type="tel"
            label={text.phone}
            autoComplete="tel"
            hint={text.phoneHint}
            defaultValue={values.phone}
            error={errorFor('phone')}
          />
          <Field
            id="profile-district"
            name="district"
            label={text.district}
            autoComplete="address-level2"
            defaultValue={values.district}
            error={errorFor('district')}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-4 text-lg font-bold text-ink">{text.academic}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field
              id="profile-institution"
              name="institution"
              label={text.institution}
              autoComplete="organization"
              defaultValue={values.institution}
              error={errorFor('institution')}
            />
          </div>
          {/* A <select> only reads defaultValue when it mounts, so the key remounts it with the
              echoed value; otherwise the automatic form reset would jump back to the old choice. */}
          <SelectField
            key={`educationType:${values.educationType}`}
            id="profile-education-type"
            name="educationType"
            label={text.educationType}
            options={educationTypes}
            placeholder={text.educationTypePlaceholder}
            defaultValue={values.educationType}
            error={errorFor('educationType')}
          />
          <SelectField
            key={`gradeLevelId:${values.gradeLevelId}`}
            id="profile-grade-level"
            name="gradeLevelId"
            label={text.gradeLevel}
            options={gradeLevels}
            placeholder={text.gradeLevelPlaceholder}
            hint={text.gradeLevelHint}
            defaultValue={values.gradeLevelId}
            error={errorFor('gradeLevelId')}
          />
        </div>
      </fieldset>

      {state.formError || hasFieldErrors ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-strong"
        >
          {state.formError ? text.formError : text.checkFields}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        loading={pending}
        loadingLabel={text.saving}
        className="w-full"
      >
        {text.submit}
      </Button>
    </form>
  );
}
