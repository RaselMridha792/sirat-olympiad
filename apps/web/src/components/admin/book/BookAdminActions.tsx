'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, PackageCheck, Upload } from 'lucide-react';
import { ADMIN_SETTING_LIMITS, BOOK_ORDER_LIMITS, type BookOrderStatus } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminBookMessages } from '@/i18n/messages/admin-book';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import {
  adminBookProblem,
  exportPath,
  preCheckCover,
  type AdminBookProblem,
} from './admin-book-rules';

const answerOf = (err: unknown) =>
  err instanceof ApiRequestError ? { status: err.status, body: err.body } : null;

/** The book's title for new orders, changed from the value the page showed (`expected`), with a reason. */
export function BookTitleForm({ locale, current }: { locale: Locale; current: string }) {
  const m = pick(adminBookMessages, locale);
  const router = useRouter();
  const [title, setTitle] = useState(current);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const next = title.trim().replace(/\s+/g, ' ');
    if (next === current) return setMessage({ text: m.title.same, error: true });
    if (
      !next ||
      next.length > BOOK_ORDER_LIMITS.titleMax ||
      reason.trim().length < ADMIN_SETTING_LIMITS.reasonMin ||
      reason.trim().length > ADMIN_SETTING_LIMITS.reasonMax
    )
      return setMessage({ text: m.title.invalid, error: true });
    setSaving(true);
    setMessage(null);
    try {
      await api('/admin/book/title', {
        method: 'PUT',
        body: JSON.stringify({ title: next, expected: current, reason: reason.trim() }),
      });
      setReason('');
      setMessage({ text: m.title.saved, error: false });
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setMessage({ text: m.errors[adminBookProblem(answerOf(err))], error: true });
    }
    setSaving(false);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        id="book-title"
        name="title"
        label={m.title.label}
        hint={m.title.hint}
        maxLength={BOOK_ORDER_LIMITS.titleMax}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Field
        id="book-title-reason"
        name="reason"
        label={m.title.reason}
        hint={m.title.reasonHint}
        maxLength={ADMIN_SETTING_LIMITS.reasonMax}
        autoComplete="off"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {message ? (
        <p
          role={message.error ? 'alert' : 'status'}
          className={
            message.error ? 'text-sm font-medium text-danger-strong' : 'text-sm text-ink-muted'
          }
        >
          {message.text}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={saving} loadingLabel={m.title.saving}>
          {m.title.save}
        </Button>
      </div>
    </form>
  );
}

/** Choose an image, see it, upload it. The API decides by the bytes; this only spares an obviously wrong upload. */
export function CoverUpload({ locale }: { locale: Locale }) {
  const m = pick(adminBookMessages, locale);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const [problem, setProblem] = useState<AdminBookProblem | null>(null);
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);

  /** One object URL at a time; the old one is released. */
  function showPreview(chosen: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = chosen ? URL.createObjectURL(chosen) : null;
    setPreview(previewUrl.current);
  }
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setDone(false);
    setProblem(chosen ? preCheckCover(chosen) : null);
    setFile(chosen);
    showPreview(chosen);
  }

  async function upload() {
    if (!file || uploading) return;
    const early = preCheckCover(file);
    if (early) return setProblem(early);
    setUploading(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/admin/book/cover', { method: 'POST', body: form });
      setDone(true);
      setFile(null);
      showPreview(null);
      if (input.current) input.current.value = '';
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setProblem(adminBookProblem(answerOf(err)));
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="cover-file" className="text-sm font-semibold text-ink">
        {m.cover.choose}
      </label>
      <input
        ref={input}
        id="cover-file"
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={choose}
        aria-describedby="cover-hint"
        className="text-sm"
      />
      <p id="cover-hint" className="text-xs text-ink-muted">
        {m.cover.hint}
      </p>
      {preview && !problem ? (
        // A local object URL of the admin's own file (never sent anywhere else).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={m.cover.preview}
          className="h-48 w-auto self-start rounded-control border border-line object-contain"
        />
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {m.errors[problem]}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-ink-muted">
          {m.cover.uploaded}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          onClick={upload}
          disabled={!file || !!problem}
          loading={uploading}
          loadingLabel={m.cover.uploading}
        >
          <Upload aria-hidden="true" size={16} />
          {m.cover.upload}
        </Button>
      </div>
    </div>
  );
}

/** The courier CSV for the current filters (status, district), saved as a file; never kept in the browser. */
export function ExportOrdersButton({
  locale,
  filters,
}: {
  locale: Locale;
  filters: { status?: BookOrderStatus; district?: string };
}) {
  const m = pick(adminBookMessages, locale).orders.export;
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'failed'>('idle');

  async function run() {
    if (state === 'pending') return;
    setState('pending');
    try {
      const file = await api<Blob>(exportPath(filters), { as: 'blob' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `book-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setState('done');
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        loading={state === 'pending'}
        loadingLabel={m.pending}
      >
        <Download aria-hidden="true" size={16} />
        {m.button}
      </Button>
      {state === 'done' ? (
        <p role="status" className="max-w-xs text-xs text-ink-muted">
          {m.done}
        </p>
      ) : null}
      {state === 'failed' ? (
        <p role="alert" className="text-xs font-medium text-danger-strong">
          {m.failed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Mark shipped" for the rows ticked in the server-rendered table (checkboxes with form="ship-form"). Asks first: a
 * shipped order cannot be changed back, by design.
 */
export function ShipSelected({ locale }: { locale: Locale }) {
  const m = pick(adminBookMessages, locale).orders.ship;
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const errors = pick(adminBookMessages, locale).errors;

  // The ticked rows live in the server-rendered table (form="ship-form"): count them as they change.
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t?.name === 'ids' && t.getAttribute('form') === 'ship-form')
        setCount(document.querySelectorAll('input[form="ship-form"][name="ids"]:checked').length);
    };
    document.addEventListener('change', onChange);
    return () => document.removeEventListener('change', onChange);
  }, []);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    const chosen = new FormData(form.current ?? undefined).getAll('ids').map(String);
    if (chosen.length === 0) return;
    setIds(chosen);
    setNote(null);
    setOpen(true);
  }

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      const out = await api<{ shipped: number }>('/admin/book-orders/ship', {
        method: 'POST',
        body: JSON.stringify({ ids, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      setOpen(false);
      setReason('');
      setNote({ text: m.done(formatNumber(locale, out.shipped)), error: false });
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setNote({ text: errors[adminBookProblem(answerOf(err))], error: true });
      setOpen(false);
    }
    setSaving(false);
  }

  return (
    <form id="ship-form" ref={form} onSubmit={ask} className="flex flex-col items-start gap-1">
      <Button type="submit" size="sm" disabled={count === 0}>
        <PackageCheck aria-hidden="true" size={16} />
        {m.button(formatNumber(locale, count))}
      </Button>
      {note ? (
        <p
          role={note.error ? 'alert' : 'status'}
          className={
            note.error ? 'text-xs font-medium text-danger-strong' : 'text-xs text-ink-muted'
          }
        >
          {note.text}
        </p>
      ) : null}
      <Dialog
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title={m.title}
        closeLabel={m.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{m.text(formatNumber(locale, ids.length))}</p>
          <Field
            id="ship-reason"
            name="reason"
            label={m.reason}
            maxLength={200}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              {m.cancel}
            </Button>
            <Button type="button" onClick={confirm} loading={saving} loadingLabel={m.pending}>
              {m.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
