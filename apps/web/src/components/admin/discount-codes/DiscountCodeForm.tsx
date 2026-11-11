'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminAmbassadorRow, AdminDiscountCode, Paginated } from '@sirat/shared';
import { Button, Dialog, Field, SelectField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminDiscountCodesMessages } from '@/i18n/messages/admin-discount-codes';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import {
  EMPTY_CODE,
  generatedCode,
  invalidField,
  toBody,
  valuesOf,
  type DiscountCodeValues,
} from './discount-code-form';
import { discountCodeProblem, type DiscountCodeProblem } from './discount-code-problem';

const offset = () => new Date().getTimezoneOffset();

/**
 * Create (`code` absent) or edit a discount code (payments D2; 06-API "Admin discount codes"). The server checks every
 * rule again; this form only turns taka and local times into the API's paisa and instants. The linked ambassador is
 * typed as their promo code and looked up in the admin ambassador list (an exact code match, approved, real).
 */
export function DiscountCodeForm({
  locale,
  code,
  onDone,
}: {
  locale: Locale;
  code?: AdminDiscountCode;
  onDone?: () => void;
}) {
  const m = pick(adminDiscountCodesMessages, locale);
  const f = m.form;
  const router = useRouter();
  const mode = code ? 'edit' : 'create';
  const locked = code?.locked ?? false;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<DiscountCodeValues>(EMPTY_CODE);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<DiscountCodeProblem | 'value' | 'maxUses' | null>(null);

  function start() {
    setValues(code ? valuesOf(code, offset()) : EMPTY_CODE);
    setProblem(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  const set = <K extends keyof DiscountCodeValues>(key: K, value: DiscountCodeValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setProblem(null);
  };

  /** The promo code as an approved, real ambassador's user id; null for none; undefined when nobody has it. */
  async function ambassadorId(): Promise<string | null | undefined> {
    const typed = values.ambassadorCode.trim();
    if (!typed) return null;
    if (code?.ambassador && code.ambassador.promoCode?.toUpperCase() === typed.toUpperCase())
      return code.ambassador.userId;
    const page = await api<Paginated<AdminAmbassadorRow>>(
      `/admin/ambassadors?status=approved&pageSize=5&q=${encodeURIComponent(typed)}`,
    );
    const hit = page.items.find(
      (a) => a.promoCode.toUpperCase() === typed.toUpperCase() && a.approvedAt && !a.demo,
    );
    return hit?.userId;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const field = invalidField(values);
    if (field) return setProblem(field);
    setPending(true);
    setProblem(null);
    try {
      const userId = await ambassadorId();
      if (userId === undefined) {
        setProblem('AMBASSADOR_INVALID');
        return;
      }
      const body = JSON.stringify(toBody(values, userId, offset(), mode));
      const saved = code
        ? await api<AdminDiscountCode>(`/admin/discount-codes/${encodeURIComponent(code.id)}`, {
            method: 'PATCH',
            body,
          })
        : await api<AdminDiscountCode>('/admin/discount-codes', { method: 'POST', body });
      setOpen(false);
      onDone?.();
      if (code) router.refresh();
      else router.push(`/admin/discount-codes?code=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      // The ambassador lookup refused (a 4xx of its own) reads as a save that did not happen.
      setProblem(error instanceof ApiRequestError ? discountCodeProblem(error) : 'failed');
    } finally {
      setPending(false);
    }
  }

  const message =
    problem === 'value'
      ? m.errors.VALUE_INVALID
      : problem === 'maxUses'
        ? m.errors.invalid
        : problem
          ? m.errors[problem]
          : '';

  return (
    <>
      <Button type="button" variant={code ? 'outline' : 'primary'} size="sm" onClick={start}>
        {code ? f.edit : m.newCode}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={code ? f.editTitle(code.code) : f.createTitle}
        closeLabel={f.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {code ? null : (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  id="discount-code"
                  name="code"
                  label={f.code}
                  hint={f.codeHint}
                  value={values.code}
                  maxLength={20}
                  autoComplete="off"
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  error={
                    problem === 'CODE_INVALID' || problem === 'CODE_TAKEN' ? message : undefined
                  }
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  set(
                    'code',
                    generatedCode((n) => crypto.getRandomValues(new Uint8Array(n))),
                  )
                }
              >
                {f.generate}
              </Button>
            </div>
          )}
          {locked ? <p className="text-sm text-ink-muted">{m.detail.locked}</p> : null}
          <SelectField
            id="discount-kind"
            name="kind"
            label={f.kind}
            value={values.kind}
            disabled={locked}
            onChange={(e) => set('kind', e.target.value === 'percent' ? 'percent' : 'amount')}
            options={[
              { value: 'amount', label: f.kindAmount },
              { value: 'percent', label: f.kindPercent },
            ]}
          />
          <Field
            id="discount-value"
            name="value"
            label={values.kind === 'percent' ? f.percent : f.amount}
            inputMode="numeric"
            value={values.value}
            disabled={locked}
            maxLength={7}
            autoComplete="off"
            onChange={(e) => set('value', e.target.value)}
            error={problem === 'value' || problem === 'VALUE_INVALID' ? message : undefined}
          />
          <Field
            id="discount-max-uses"
            name="maxUses"
            label={f.maxUses}
            hint={f.maxUsesHint}
            inputMode="numeric"
            value={values.maxUses}
            maxLength={7}
            autoComplete="off"
            onChange={(e) => set('maxUses', e.target.value)}
            error={problem === 'maxUses' ? message : undefined}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="discount-starts"
              name="startsAt"
              label={f.startsAt}
              hint={f.dateHint}
              type="datetime-local"
              value={values.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
            <Field
              id="discount-ends"
              name="endsAt"
              label={f.endsAt}
              type="datetime-local"
              value={values.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
              error={problem === 'WINDOW_INVALID' ? message : undefined}
            />
          </div>
          <label className="flex items-start gap-3 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => set('active', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            {f.active}
          </label>
          <Field
            id="discount-ambassador"
            name="ambassadorCode"
            label={f.ambassador}
            hint={f.ambassadorHint}
            value={values.ambassadorCode}
            disabled={locked}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => set('ambassadorCode', e.target.value)}
            error={problem === 'AMBASSADOR_INVALID' ? message : undefined}
          />
          <Field
            id="discount-note"
            name="note"
            label={f.note}
            value={values.note}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => set('note', e.target.value)}
          />
          {problem &&
          !['value', 'maxUses', 'VALUE_INVALID', 'WINDOW_INVALID', 'AMBASSADOR_INVALID'].includes(
            problem,
          ) &&
          !(code === undefined && (problem === 'CODE_INVALID' || problem === 'CODE_TAKEN')) ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {f.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? f.pending : code ? f.save : f.create}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
