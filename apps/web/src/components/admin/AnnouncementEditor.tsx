'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Pencil } from 'lucide-react';
import {
  ANNOUNCEMENT_LIMITS,
  CATEGORIES,
  type AdminAnnouncement,
  type Category,
} from '@sirat/shared';
import { Button, Dialog, Field, SelectField, TextAreaField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAnnouncementsMessages } from '@/i18n/messages/admin-announcements';
import { api, SessionExpiredError } from '@/lib/api';
import {
  announcementProblem,
  isoToLocal,
  localToIso,
  type AnnouncementProblem,
} from './announcement-problem';

/** The fields of an announcement the edit dialog needs (picked by the page). */
export type EditableAnnouncement = Pick<
  AdminAnnouncement,
  'id' | 'title' | 'body' | 'category' | 'publishedAt' | 'updatedAt'
>;

type Problem = AnnouncementProblem | 'title' | 'body';

/**
 * "New announcement" and "Edit": a dialog that writes through api() (POST /api/admin/announcements, or PATCH with the
 * version the dialog opened, so another admin's change is never overwritten: 409 stale). Plain text only.
 */
export function AnnouncementEditor({
  locale,
  categoryLabels,
  announcement,
}: {
  locale: Locale;
  categoryLabels: Record<Category, string>;
  /** Absent: create. */
  announcement?: EditableAnnouncement;
}) {
  const m = pick(adminAnnouncementsMessages, locale);
  const router = useRouter();
  const key = announcement?.id ?? 'new';
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body ?? '');
  const [category, setCategory] = useState<string>(announcement?.category ?? '');
  const [publishAt, setPublishAt] = useState(
    announcement ? isoToLocal(announcement.publishedAt) : '',
  );
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  function request(t: string, b: string): { path: string; method: string; body: unknown } {
    const audience = (category || null) as Category | null;
    const at = localToIso(publishAt);
    if (!announcement)
      return {
        path: '/admin/announcements',
        method: 'POST',
        body: { title: t, body: b, category: audience, ...(at ? { publishAt: at } : {}) },
      };
    const timeChanged = at !== undefined && publishAt !== isoToLocal(announcement.publishedAt);
    return {
      path: `/admin/announcements/${encodeURIComponent(announcement.id)}`,
      method: 'PATCH',
      body: {
        expectedUpdatedAt: announcement.updatedAt,
        title: t,
        body: b,
        category: audience,
        ...(timeChanged ? { publishAt: at } : {}),
      },
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const t = title.trim();
    const b = body.trim();
    const { title: tl, body: bl } = ANNOUNCEMENT_LIMITS;
    if (t.length < tl.min || t.length > tl.max) {
      setProblem('title');
      return;
    }
    if (b.length < bl.min || b.length > bl.max) {
      setProblem('body');
      return;
    }
    const call = request(t, b);
    setPending(true);
    setProblem(null);
    try {
      await api<AdminAnnouncement>(call.path, {
        method: call.method,
        body: JSON.stringify(call.body),
      });
      if (!announcement) {
        setTitle('');
        setBody('');
        setCategory('');
        setPublishAt('');
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(announcementProblem(error));
    } finally {
      setPending(false);
    }
  }

  const general =
    problem && problem !== 'title' && problem !== 'body' && problem !== 'publishInPast'
      ? m.errors[problem]
      : null;
  return (
    <>
      <Button
        type="button"
        variant={announcement ? 'ghost' : 'primary'}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {announcement ? (
          <Pencil aria-hidden="true" size={16} />
        ) : (
          <Megaphone aria-hidden="true" size={16} />
        )}
        {announcement ? m.editor.edit : m.editor.create}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={announcement ? m.editor.editTitle : m.editor.createTitle}
        closeLabel={m.editor.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            id={`ann-title-${key}`}
            name="title"
            label={m.editor.titleLabel}
            value={title}
            maxLength={ANNOUNCEMENT_LIMITS.title.max}
            onChange={(e) => setTitle(e.target.value)}
            error={problem === 'title' ? m.errors.title : undefined}
          />
          <TextAreaField
            id={`ann-body-${key}`}
            name="body"
            label={m.editor.bodyLabel}
            hint={m.editor.bodyHint}
            value={body}
            maxLength={ANNOUNCEMENT_LIMITS.body.max}
            onChange={(e) => setBody(e.target.value)}
            error={problem === 'body' ? m.errors.body : undefined}
          />
          <SelectField
            id={`ann-audience-${key}`}
            name="category"
            label={m.editor.audience}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={m.everyone}
            options={CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c] }))}
          />
          <Field
            id={`ann-publish-${key}`}
            name="publishAt"
            type="datetime-local"
            label={m.editor.publishAt}
            hint={m.editor.publishAtHint}
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            error={problem === 'publishInPast' ? m.errors.publishInPast : undefined}
          />
          {general ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {general}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.editor.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.editor.pending : announcement ? m.editor.saveEdit : m.editor.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
