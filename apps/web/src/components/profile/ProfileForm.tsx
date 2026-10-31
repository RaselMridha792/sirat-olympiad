'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProfileFieldError, ProfileUpdate, StudentProfile } from '@sirat/shared';
import { Button, Field, SelectField, type SelectOption } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import { parseProfileForm } from '@/data/profile';
import { api, SessionExpiredError } from '@/lib/api';
import { saveProblem } from './save-problem';

/** The allow-listed fields (PROFILE_UPDATE_FIELDS). role, email, grade and category are never in the form. */
export type ProfileField = keyof ProfileUpdate;
export type ProfileFormValues = Record<ProfileField, string>;

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
  districtPlaceholder: string;
  institution: string;
  educationType: string;
  educationTypePlaceholder: string;
  gradeLevel: string;
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

/**
 * The profile edit form. It saves from the browser through lib/api.ts (PATCH /api/users/me, same origin, the
 * session cookie, the 401 → refresh retry), never through the web server (DECISIONS "Web data layer over HTTP"
 * rule 5). No user id is sent: the API takes the user from the session. parseProfileForm reads only the allow-list
 * and checks the same limits as the server; the server decides, including the owner's phone rule.
 */
export function ProfileForm({
  initial,
  email,
  gradeLabel,
  lists,
  educationTypes,
  districts,
  text,
}: {
  initial: ProfileFormValues;
  email: string;
  gradeLabel: string | null;
  /** The server lists the form checks against: strings only, so no other field can reach the browser. */
  lists: { districts: string[]; educationTypes: string[] };
  educationTypes: SelectOption[];
  districts: SelectOption[];
  text: ProfileFormText;
}) {
  const router = useRouter();
  // Until the JavaScript runs, a submit would post natively: keep it disabled (DECISIONS web session #10).
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileField, ProfileFieldError>>>(
    {},
  );
  const [formError, setFormError] = useState(false);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const errorFor = (field: ProfileField): string | undefined => {
    const code = fieldErrors[field];
    return code ? (text.fieldErrors[field]?.[code] ?? text.errors[code]) : undefined;
  };

  // After a failed save, move focus to the first field that needs fixing.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = Object.fromEntries(new FormData(event.currentTarget));
    const { value, result } = parseProfileForm(input, lists);
    setFormError(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      await api<StudentProfile>('/users/me', { method: 'PATCH', body: JSON.stringify(value) });
    } catch (error) {
      setPending(false);
      if (error instanceof SessionExpiredError) return; // api() is taking the browser to /login
      if (saveProblem(error) === 'phoneTaken') setFieldErrors({ phone: 'taken' });
      else setFormError(true);
      return;
    }
    // Name and category also show in the dashboard layout: re-render it on the server.
    router.replace('/dashboard/profile?saved=1');
    router.refresh();
  }

  return (
    <form ref={formRef} method="post" onSubmit={submit} noValidate className="space-y-8">
      <fieldset>
        <legend className="mb-4 text-lg font-bold text-ink">{text.personal}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            id="profile-name"
            name="name"
            label={text.name}
            required
            autoComplete="name"
            defaultValue={initial.name}
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
            required
            autoComplete="tel"
            hint={text.phoneHint}
            defaultValue={initial.phone}
            error={errorFor('phone')}
          />
          <SelectField
            id="profile-district"
            name="district"
            label={text.district}
            required
            options={districts}
            placeholder={text.districtPlaceholder}
            defaultValue={initial.district}
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
              required
              autoComplete="organization"
              defaultValue={initial.institution}
              error={errorFor('institution')}
            />
          </div>
          <SelectField
            id="profile-education-type"
            name="educationType"
            label={text.educationType}
            required
            options={educationTypes}
            placeholder={text.educationTypePlaceholder}
            defaultValue={initial.educationType}
            error={errorFor('educationType')}
          />
          {/* Read only: the class sets the category, so only an admin corrects it (core plan Q1). */}
          <dl className="space-y-1.5">
            <dt className="text-sm font-semibold text-ink">{text.gradeLevel}</dt>
            <dd className="rounded-control border border-line bg-page px-4 py-3 text-ink-muted">
              {gradeLabel ?? '—'}
            </dd>
            <dd className="text-xs text-ink-faint">{text.gradeLevelHint}</dd>
          </dl>
        </div>
      </fieldset>

      {formError || hasFieldErrors ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-strong"
        >
          {formError ? text.formError : text.checkFields}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        loading={pending}
        loadingLabel={text.saving}
        disabled={!hydrated}
        className="w-full"
      >
        {text.submit}
      </Button>
    </form>
  );
}
