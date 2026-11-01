'use client';
import { useState } from 'react';
import { ClipboardPlus } from 'lucide-react';
import type { TaskAssignResult } from '@sirat/shared';
import { Button, Dialog, SelectField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminTasksMessages } from '@/i18n/messages/admin-tasks';
import { useTaskAction } from './use-task-action';

/** "Assign task" on an ambassador's row: one of the active tasks (ids and titles only, from the page). */
export function AssignTaskButton({
  locale,
  userId,
  tasks,
}: {
  locale: Locale;
  userId: string;
  tasks: ReadonlyArray<{ id: string; title: string }>;
}) {
  const m = pick(adminTasksMessages, locale);
  const a = m.assign;
  const { pending, problem, setProblem, run } = useTaskAction();
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!taskId) {
      setProblem('invalid');
      return;
    }
    const answer = await run<TaskAssignResult>(
      `/admin/tasks/${encodeURIComponent(taskId)}/assign`,
      'POST',
      { userIds: [userId] },
    );
    if (answer) {
      setDone(a.done(answer.assigned));
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setProblem(null);
          setDone(null);
          setTaskId('');
          setOpen(true);
        }}
      >
        <ClipboardPlus aria-hidden="true" size={16} />
        {a.button}
      </Button>
      {done ? (
        <p role="status" className="text-xs text-ink-muted">
          {done}
        </p>
      ) : null}
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={a.title}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {tasks.length === 0 ? (
            <p className="text-sm text-ink-muted">{a.none}</p>
          ) : (
            <SelectField
              id={`assign-task-${userId}`}
              name="taskId"
              label={a.task}
              placeholder={a.choose}
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              options={tasks.map((t) => ({ value: t.id, label: t.title }))}
            />
          )}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending || tasks.length === 0}>
              {pending ? m.pending : a.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
