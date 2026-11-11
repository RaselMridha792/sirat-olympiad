'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Info, Lock, Mail, Phone, School, Tag, User } from 'lucide-react';
import type { CurrentRegistration, RegistrationInfo, RegistrationQuote } from '@sirat/shared';
import { Button, cn, Field, SelectField } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { registrationMessages, type RegistrationMessages } from '@/i18n/messages/registration';
import { ApiRequestError } from '@/lib/api';
import {
  goToCheckout,
  newStartRequestId,
  registrationApi,
  type Checkout,
} from './registration-api';
import {
  EMPTY_FORM,
  STEPS,
  stepOf,
  toStartInput,
  validateStep,
  type FieldErrors,
  type FieldKey,
  type FormValues,
  type StepKey,
} from './registration-form';
import { problemText, registrationProblem } from './registration-problem';
import { withBusyRetry } from './start-retry';

export type WizardInfo = Omit<RegistrationInfo, 'open' | 'opensAt' | 'closesAt' | 'fee'> & {
  fee: NonNullable<RegistrationInfo['fee']>;
};

type Texts = Partial<Record<FieldKey, string>>;

const answerOf = (err: unknown) =>
  err instanceof ApiRequestError ? { status: err.status, body: err.body } : null;

/**
 * The registration wizard (old registration-full: Step1, Step2, payment). Three steps on one form, then PayStation:
 * 1. about you (name, mobile, email, password), 2. your school (district, institution, education type, class,
 * promo code), 3. check and pay. Nothing is stored in the browser: the form goes to POST /registrations/start once,
 * the API keeps it server-side and answers with the checkout URL (06-API "Registration and payment").
 * - The submit stays disabled until hydrated, and the form posts (never GET): a submit before React ran can never
 *   put the password in a URL (DECISIONS "Web session", item 10).
 * - One startRequestId per submit: a double click or a lost answer returns the same payment. It is kept after a
 *   network error (the outcome is unknown) and renewed after a definite refusal.
 * - After "the payment could not start", the attempt exists (the API set the `sirat_reg` cookie): the button then
 *   retries it (a new invoice) instead of starting again.
 */
export function RegisterWizard({ locale, info }: { locale: Locale; info: WizardInfo }) {
  const m = pick(registrationMessages, locale);
  const hydrated = useHydrated();
  const [step, setStep] = useState<StepKey>('you');
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [fieldText, setFieldText] = useState<Texts>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [retryMode, setRetryMode] = useState(false);
  // The server's price for the promo code as typed (POST /registrations/quote); the start prices again itself.
  const [quote, setQuote] = useState<{ code: string; result: RegistrationQuote } | null>(null);
  const [applying, setApplying] = useState(false);
  const requestId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const choices = useMemo(
    () => ({
      districts: info.districts,
      educationTypes: info.educationTypes,
      gradeLevelIds: info.gradeLevels.map((g) => g.id),
    }),
    [info],
  );
  const amount = formatNumber(locale, info.fee.amountMinor / 100);
  const code = values.promoCode.trim();
  const priced = quote && quote.code === code ? quote.result : null;
  const taka = (minor: number) => formatNumber(locale, minor / 100);
  const payAmount = taka(priced?.amountMinor ?? info.fee.amountMinor);
  const index = STEPS.indexOf(step);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  function goTo(target: StepKey) {
    moved.current = true;
    setStep(target);
  }

  function update(field: FieldKey) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setValues((v) => ({ ...v, [field]: value }));
      setFieldText((t) => ({ ...t, [field]: undefined }));
      // Changed details make a new submit: a new request id, and no retry of the old attempt.
      requestId.current = null;
      setRetryMode(false);
    };
  }

  function show(errors: FieldErrors) {
    const texts: Texts = {};
    for (const [field, key] of Object.entries(errors)) texts[field as FieldKey] = m.invalid[key];
    setFieldText(texts);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 'review') {
      void pay();
      return;
    }
    void next();
  }

  async function next() {
    const errors = validateStep(step, values, choices);
    if (Object.keys(errors).length > 0) return show(errors);
    setFieldText({});
    setFormError('');
    // A promo code is priced before the review, so the review and the button show what the start will charge.
    if (step === 'school' && !(await checkCode())) return;
    goTo(STEPS[index + 1] ?? 'review');
  }

  /** Asks the server what this code does to the price; a miss is the field's PROMO_INVALID. True when usable. */
  async function checkCode(): Promise<boolean> {
    if (!code) {
      setQuote(null);
      return true;
    }
    if (priced) return true;
    const format = validateStep('school', values, choices).promoCode;
    if (format) {
      show({ promoCode: format });
      return false;
    }
    setApplying(true);
    setFormError('');
    try {
      const result = await registrationApi.quote(code);
      setQuote({ code, result });
      setFieldText((t) => ({ ...t, promoCode: undefined }));
      return true;
    } catch (err) {
      const problem = registrationProblem(answerOf(err));
      if (problem.kind === 'field') setFieldText({ [problem.field]: problemText(m, problem.text) });
      else if (problem.kind === 'form') setFormError(problemText(m, problem.text));
      return false;
    } finally {
      setApplying(false);
    }
  }

  async function pay() {
    if (pending) return;
    for (const s of ['you', 'school'] as const) {
      const errors = validateStep(s, values, choices);
      if (Object.keys(errors).length > 0) {
        show(errors);
        goTo(s);
        return;
      }
    }
    setPending(true);
    setFormError('');
    try {
      requestId.current ??= newStartRequestId();
      const input = toStartInput(values, requestId.current);
      // A busy database (503 SERVICE_BUSY) gets one automatic retry of the same start (same startRequestId);
      // the payment retry is not idempotent, so it never is.
      const started = retryMode
        ? await registrationApi.retry()
        : await withBusyRetry(() => registrationApi.start(input));
      if (goToCheckout(started)) return; // stay busy while PayStation loads
      setFormError(m.errors.PAYMENT_START_FAILED);
    } catch (err) {
      fail(err);
    }
    setPending(false);
  }

  function fail(err: unknown) {
    if (err instanceof ApiRequestError && err.body?.code === 'NOTHING_TO_RESUME') {
      // A repeated submit of an attempt whose payment could not start: retry it.
      setRetryMode(true);
      setFormError(m.errors.PAYMENT_START_FAILED);
      return;
    }
    if (retryMode && err instanceof ApiRequestError && err.status === 404) {
      // The attempt is gone (cookie cleared): start again.
      setRetryMode(false);
      requestId.current = null;
    }
    const problem = registrationProblem(answerOf(err));
    if (problem.kind === 'newRequest') {
      requestId.current = null;
      setFormError(m.errors.START_REQUEST_REUSED);
      return;
    }
    if (problem.kind === 'field') {
      requestId.current = null;
      setFieldText({ [problem.field]: problemText(m, problem.text) });
      goTo(stepOf(problem.field));
      return;
    }
    if (problem.text === 'PAYMENT_START_FAILED') setRetryMode(true);
    // The attempt's form was cleared after 30 days (D6) and the API gave it up: the next press starts a new one.
    else if (problem.text === 'START_OVER') setRetryMode(false);
    else if (!['network', 'busy', 'START_IN_PROGRESS'].includes(problem.text))
      requestId.current = null;
    setFormError(problemText(m, problem.text));
  }

  const grade = info.gradeLevels.find((g) => g.id === values.gradeLevelId)?.label ?? '';
  const choose = m.fields.choose;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-3xl font-bold">{m.title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{m.fee(amount)}</p>
      </div>
      <PreviousAttempt m={m} />
      <ol
        className="flex items-center justify-center gap-2"
        aria-label={m.step(formatNumber(locale, index + 1), formatNumber(locale, STEPS.length))}
      >
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn('h-2 w-10 rounded-full', i <= index ? 'bg-primary-strong' : 'bg-line')}
          >
            <span className="sr-only">{m.steps[s]}</span>
          </li>
        ))}
      </ol>
      {/* method="post": even a submit that slipped past the disabled button never puts the form in a URL. */}
      <form
        id="registration-form"
        method="post"
        onSubmit={onSubmit}
        noValidate
        className="space-y-4"
      >
        <div>
          <p className="text-xs font-semibold text-ink-muted">
            {m.step(formatNumber(locale, index + 1), formatNumber(locale, STEPS.length))}
          </p>
          <h3 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
            {m.steps[step]}
          </h3>
        </div>

        {step === 'you' ? (
          <>
            <Field
              label={m.fields.name}
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              value={values.name}
              onChange={update('name')}
              error={fieldText.name}
              icon={<User size={18} />}
            />
            <Field
              label={m.fields.phone}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={20}
              hint={m.fields.phoneHint}
              value={values.phone}
              onChange={update('phone')}
              error={fieldText.phone}
              icon={<Phone size={18} />}
            />
            <Field
              label={m.fields.email}
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              hint={m.fields.emailHint}
              value={values.email}
              onChange={update('email')}
              error={fieldText.email}
              icon={<Mail size={18} />}
            />
            <Field
              label={m.fields.password}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              hint={m.fields.passwordHint}
              value={values.password}
              onChange={update('password')}
              error={fieldText.password}
              icon={<Lock size={18} />}
            />
          </>
        ) : null}

        {step === 'school' ? (
          <>
            <SelectField
              id="district"
              name="district"
              label={m.fields.district}
              placeholder={choose}
              value={values.district}
              onChange={update('district')}
              error={fieldText.district}
              options={info.districts.map((d) => ({ value: d, label: d }))}
            />
            <Field
              label={m.fields.institution}
              name="institution"
              autoComplete="organization"
              required
              maxLength={150}
              value={values.institution}
              onChange={update('institution')}
              error={fieldText.institution}
              icon={<School size={18} />}
            />
            <SelectField
              id="educationType"
              name="educationType"
              label={m.fields.educationType}
              placeholder={choose}
              value={values.educationType}
              onChange={update('educationType')}
              error={fieldText.educationType}
              options={info.educationTypes.map((t) => ({ value: t, label: t }))}
            />
            <SelectField
              id="gradeLevelId"
              name="gradeLevelId"
              label={m.fields.grade}
              placeholder={choose}
              value={values.gradeLevelId}
              onChange={update('gradeLevelId')}
              error={fieldText.gradeLevelId}
              options={info.gradeLevels.map((g) => ({ value: g.id, label: g.label }))}
            />
            <Field
              label={m.fields.promoCode}
              name="promoCode"
              autoComplete="off"
              maxLength={40}
              hint={m.fields.promoHint}
              value={values.promoCode}
              onChange={update('promoCode')}
              error={fieldText.promoCode}
              icon={<Tag size={18} />}
            />
            {code ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={applying}
                  loadingLabel={m.applyCode}
                  disabled={!hydrated || Boolean(priced)}
                  onClick={() => void checkCode()}
                >
                  {m.applyCode}
                </Button>
                {priced ? (
                  <p role="status" className="text-sm font-medium text-success-strong">
                    {priced.discountMinor > 0
                      ? m.codeApplied(taka(priced.discountMinor), taka(priced.amountMinor))
                      : m.codeAccepted}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'review' ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">{m.reviewNote}</p>
            <Summary
              title={m.steps.you}
              edit={m.edit}
              onEdit={() => goTo('you')}
              icon={<User aria-hidden="true" size={16} />}
              rows={[
                [m.fields.name, values.name.trim()],
                [m.fields.phone, values.phone.trim()],
                [m.fields.email, values.email.trim()],
              ]}
            />
            <Summary
              title={m.steps.school}
              edit={m.edit}
              onEdit={() => goTo('school')}
              icon={<GraduationCap aria-hidden="true" size={16} />}
              rows={[
                [m.fields.district, values.district],
                [m.fields.institution, values.institution.trim()],
                [m.fields.educationType, values.educationType],
                [m.fields.grade, grade],
                ...(values.promoCode.trim()
                  ? [[m.fields.promoCode, values.promoCode.trim()] as [string, string]]
                  : []),
              ]}
            />
            {priced && priced.discountMinor > 0 ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-card border border-line p-4 text-sm">
                <dt className="text-ink-muted">{m.price.fee}</dt>
                <dd className="text-right">৳{taka(priced.listAmountMinor)}</dd>
                <dt className="text-ink-muted">{m.price.discount}</dt>
                <dd className="text-right text-success-strong">−৳{taka(priced.discountMinor)}</dd>
                <dt className="font-semibold text-ink">{m.price.total}</dt>
                <dd className="text-right font-semibold text-ink">৳{taka(priced.amountMinor)}</dd>
              </dl>
            ) : null}
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="text-center text-sm font-medium text-danger-strong">
            {formError}
          </p>
        ) : null}

        <div className="flex gap-3">
          {index > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending}
              onClick={() => goTo(STEPS[index - 1] ?? 'you')}
            >
              {m.back}
            </Button>
          ) : null}
          <Button
            type="submit"
            size="lg"
            loading={pending}
            loadingLabel={m.paying}
            disabled={!hydrated}
            className="flex-1"
          >
            {step === 'review' ? (retryMode ? m.previous.tryAgain : m.pay(payAmount)) : m.next}
          </Button>
        </div>
      </form>
      <p className="text-center text-sm text-ink-muted">
        {m.haveAccount}{' '}
        <Link href="/login" className="font-bold text-secondary hover:underline">
          {m.login}
        </Link>
      </p>
    </div>
  );
}

function Summary({
  title,
  edit,
  onEdit,
  icon,
  rows,
}: {
  title: string;
  edit: string;
  onEdit: () => void;
  icon: React.ReactNode;
  rows: [string, string][];
}) {
  return (
    <section className="rounded-control border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-ink">
          {icon}
          {title}
        </h4>
        <button
          type="button"
          onClick={onEdit}
          className="text-sm font-semibold text-secondary hover:underline"
        >
          {edit}
        </button>
      </div>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="break-words font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * This browser's earlier attempt (the `sirat_reg` cookie), read once on load: continue a payment in progress, retry
 * one that failed or expired (the details are already saved), or see the status. No personal data comes back.
 */
function PreviousAttempt({ m }: { m: RegistrationMessages }) {
  const [current, setCurrent] = useState<CurrentRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const p = m.previous;

  useEffect(() => {
    let live = true;
    registrationApi
      .current()
      .then((c) => {
        if (live) setCurrent(c);
      })
      .catch(() => undefined); // 404: no attempt in this browser; anything else: the form still works
    return () => {
      live = false;
    };
  }, []);

  if (!current) return null;

  async function act(call: () => Promise<Checkout | void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await call();
      if (result && goToCheckout(result)) return;
      if (!result) setCurrent(null); // cancelled: a fresh form
    } catch (err) {
      const problem = registrationProblem(answerOf(err));
      setError(
        problem.kind === 'form' ? problemText(m, problem.text) : m.errors.PAYMENT_START_FAILED,
      );
    }
    setBusy(false);
  }

  const canResume = current.canResume;
  const canRetry = current.canRetry;
  let text: string;
  if (current.state === 'completed') text = p.completed;
  else if (current.state === 'confirming' || current.state === 'needs_help') text = p.confirming;
  else if (canResume) text = p.resume;
  else if (canRetry) text = p.retry;
  else return null;

  return (
    <div role="status" className="rounded-control border border-line bg-page p-4 text-sm">
      <p className="flex items-start gap-2 font-medium text-ink">
        <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-secondary" />
        {text}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canResume ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => act(registrationApi.resume)}
          >
            {p.continue}
          </Button>
        ) : null}
        {canRetry ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => act(registrationApi.retry)}
            >
              {p.tryAgain}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act(registrationApi.cancel)}
            >
              {p.startOver}
            </Button>
          </>
        ) : null}
        {current.state === 'confirming' || current.state === 'needs_help' ? (
          <Link href="/register/result" className="font-semibold text-secondary hover:underline">
            {p.status}
          </Link>
        ) : null}
        {current.state === 'completed' ? (
          <Link href="/login" className="font-semibold text-secondary hover:underline">
            {m.login}
          </Link>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
