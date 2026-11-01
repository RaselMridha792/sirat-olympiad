'use client';
import { useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button, Dialog } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminTasksMessages } from '@/i18n/messages/admin-tasks';
import { useTaskAction } from './use-task-action';

/** Archive or restore a task (never deleted; core C5b-2). */
export function TaskStateButton({
  locale,
  taskId,
  archived,
}: {
  locale: Locale;
  taskId: string;
  archived: boolean;
}) {
  const m = pick(adminTasksMessages, locale);
  const { pending, problem, setProblem, run } = useTaskAction();
  const [open, setOpen] = useState(false);
  const label = archived ? m.state.restore : m.state.archive;

  async function confirm() {
    const done = await run(
      `/admin/tasks/${encodeURIComponent(taskId)}/${archived ? 'restore' : 'archive'}`,
      'POST',
    );
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
      >
        {archived ? (
          <ArchiveRestore aria-hidden="true" size={16} />
        ) : (
          <Archive aria-hidden="true" size={16} />
        )}
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={label}
        closeLabel={m.cancel}
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
              {m.cancel}
            </Button>
            <Button type="button" onClick={confirm} disabled={pending}>
              {pending ? m.pending : m.state.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
