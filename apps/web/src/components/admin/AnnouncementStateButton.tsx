'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import type { AdminAnnouncement } from '@sirat/shared';
import { Button, Dialog } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAnnouncementsMessages } from '@/i18n/messages/admin-announcements';
import { api, SessionExpiredError } from '@/lib/api';
import { announcementProblem, type AnnouncementProblem } from './announcement-problem';

/** Archive or restore, after a confirmation (POST /api/admin/announcements/:id/{archive,restore}). Nothing is deleted. */
export function AnnouncementStateButton({
  locale,
  id,
  updatedAt,
  archived,
}: {
  locale: Locale;
  id: string;
  updatedAt: string;
  archived: boolean;
}) {
  const m = pick(adminAnnouncementsMessages, locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<AnnouncementProblem | null>(null);
  const action = archived ? 'restore' : 'archive';

  async function confirm() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      await api<AdminAnnouncement>(`/admin/announcements/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(announcementProblem(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {archived ? (
          <ArchiveRestore aria-hidden="true" size={16} />
        ) : (
          <Archive aria-hidden="true" size={16} />
        )}
        {archived ? m.state.restore : m.state.archive}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={archived ? m.state.restoreTitle : m.state.archiveTitle}
        closeLabel={m.state.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            {archived ? m.state.restoreText : m.state.archiveText}
          </p>
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.state.cancel}
            </Button>
            <Button
              type="button"
              variant={archived ? 'primary' : 'danger'}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? m.state.pending : m.state.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
