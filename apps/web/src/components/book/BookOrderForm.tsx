'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Phone, User } from 'lucide-react';
import { BD_DISTRICTS, BOOK_ORDER_LIMITS, type MyBookOrderView } from '@sirat/shared';
import { Badge, Button, DetailList, Field, SelectField } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { bookMessages } from '@/i18n/messages/book';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import {
  bookProblem,
  initialBookValues,
  toBookInput,
  validateBookForm,
  type BookField,
  type BookFormValues,
} from './book-order-rules';

/**
 * The student's delivery address for the free book (plan §16; owner B4, B5): confirm it, see it, change it until it
 * is shipped. PUT /api/book-order/me through api() (same origin, CSRF header, session renewal); the version the page
 * showed always goes along once an order exists, so an old tab never overwrites a newer change. The form posts
 * (never GET) and waits for hydration.
 */
export function BookOrderForm({
  locale,
  order: initialOrder,
  profile,
}: {
  locale: Locale;
  order: MyBookOrderView | null;
  profile: { name: string; phone: string | null; district: string | null };
}) {
  const m = pick(bookMessages, locale);
  const router = useRouter();
  const hydrated = useHydrated();
  const [order, setOrder] = useState(initialOrder);
  const [editing, setEditing] = useState(initialOrder === null);
  const [values, setValues] = useState<BookFormValues>(() =>
    initialBookValues(initialOrder, profile),
  );
  const [fieldText, setFieldText] = useState<Partial<Record<BookField, string>>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(field: BookField) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setValues((v) => ({ ...v, [field]: value }));
      setFieldText((t) => ({ ...t, [field]: undefined }));
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const errors = validateBookForm(values);
    if (Object.keys(errors).length > 0) {
      const texts: Partial<Record<BookField, string>> = {};
      for (const [field, key] of Object.entries(errors)) texts[field as BookField] = m.invalid[key];
      setFieldText(texts);
      return;
    }
    setSaving(true);
    setFormError('');
    setSaved(false);
    try {
      const next = await api<MyBookOrderView>('/book-order/me', {
        method: 'PUT',
        body: JSON.stringify(toBookInput(values, order)),
      });
      setOrder(next);
      setValues(initialBookValues(next, profile));
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return; // api() is taking the browser to /login
      setFormError(
        m.errors[
          bookProblem(
            err instanceof ApiRequestError ? { status: err.status, body: err.body } : null,
          )
        ],
      );
    }
    setSaving(false);
  }

  if (order && !editing) {
    const shipped = order.status === 'shipped';
    return (
      <section className="space-y-4" aria-labelledby="book-order-title">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="book-order-title" className="text-lg font-bold text-ink">
            {shipped ? m.order.shippedTitle : m.order.confirmedTitle}
          </h2>
          <Badge tone={shipped ? 'success' : 'info'}>
            {shipped ? m.order.shippedTitle : m.order.confirmedTitle}
          </Badge>
        </div>
        <p className="text-sm text-ink-muted">
          {shipped && order.shippedAt
            ? m.order.shippedOn(formatDate(locale, order.shippedAt))
            : m.order.confirmedText}
        </p>
        <DetailList
          columns={2}
          items={[
            { label: m.order.book, value: order.bookTitle },
            { label: m.order.recipient, value: order.recipientName },
            { label: m.order.phone, value: order.recipientPhone },
            {
              label: m.order.address,
              value: `${order.addressLine}, ${order.upazila}, ${order.district}`,
            },
            ...(order.note ? [{ label: m.order.note, value: order.note }] : []),
          ]}
        />
        {saved ? (
          <p role="status" className="text-sm font-medium text-success-strong">
            {m.saved}
          </p>
        ) : null}
        {!shipped ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            {m.order.change}
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    // method="post": a submit before hydration never puts the address in a URL.
    <form id="book-order-form" method="post" onSubmit={submit} noValidate className="space-y-4">
      <Field
        label={m.fields.recipientName}
        name="recipientName"
        autoComplete="name"
        maxLength={BOOK_ORDER_LIMITS.recipientNameMax}
        value={values.recipientName}
        onChange={update('recipientName')}
        error={fieldText.recipientName}
        icon={<User size={18} />}
      />
      <Field
        label={m.fields.recipientPhone}
        name="recipientPhone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        hint={m.fields.phoneHint}
        value={values.recipientPhone}
        onChange={update('recipientPhone')}
        error={fieldText.recipientPhone}
        icon={<Phone size={18} />}
      />
      <SelectField
        id="district"
        name="district"
        label={m.fields.district}
        placeholder={m.fields.choose}
        value={values.district}
        onChange={update('district')}
        error={fieldText.district}
        options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
      />
      <Field
        label={m.fields.upazila}
        name="upazila"
        maxLength={BOOK_ORDER_LIMITS.upazilaMax}
        value={values.upazila}
        onChange={update('upazila')}
        error={fieldText.upazila}
      />
      <Field
        label={m.fields.addressLine}
        name="addressLine"
        autoComplete="street-address"
        maxLength={BOOK_ORDER_LIMITS.addressLineMax}
        value={values.addressLine}
        onChange={update('addressLine')}
        error={fieldText.addressLine}
        icon={<MapPin size={18} />}
      />
      <Field
        label={m.fields.note}
        name="note"
        maxLength={BOOK_ORDER_LIMITS.noteMax}
        value={values.note}
        onChange={update('note')}
        error={fieldText.note}
      />
      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving} loadingLabel={m.saving} disabled={!hydrated}>
          {order ? m.submitChange : m.submitFirst}
        </Button>
        {order ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setValues(initialBookValues(order, profile));
              setFieldText({});
              setFormError('');
              setEditing(false);
            }}
          >
            {m.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
