'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { TASK_LIMITS as L, type AdminTaskRow } from '@sirat/shared';
import { Button, Dialog, Field, TextAreaField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminTasksMessages } from '@/i18n/messages/admin-tasks';
import { useTaskAction } from './use-task-action';

type Editable = Pick<AdminTaskRow, 'id' | 'title' | 'description' | 'points' | 'updatedAt'>;

/** "New task" or "Edit" (core C5b-2): POST /admin/tasks, or PATCH with the version the admin saw. */
export function TaskEditor({ locale, task }: { locale: Locale; task?: Editable }) {
  const m = pick(adminTasksMessages, locale);
  const e = m.editor;
  const { pending, problem, setProblem, run } = useTaskAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [points, setPoints] = useState(task ? String(task.points) : '');

  function start() {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setPoints(task ? String(task.points) : '');
    setProblem(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(points.trim());
    const t = title.trim();
    const d = description.trim();
    if (
      t.length < L.titleMin ||
      t.length > L.titleMax ||
      d.length < 1 ||
      d.length > L.descriptionMax ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > L.pointsMax
    ) {
      setProblem('invalid');
      return;
    }
    const body = { title: t, description: d, points: value };
    const done = task
      ? await run(`/admin/tasks/${encodeURIComponent(task.id)}`, 'PATCH', {
          ...body,
          expectedUpdatedAt: task.updatedAt,
        })
      : await run('/admin/tasks', 'POST', body);
    if (done) setOpen(false);
  }

  return (
    <>
      <Button type="button" variant={task ? 'ghost' : 'primary'} size="sm" onClick={start}>
        {task ? <Pencil aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
        {task ? e.edit : m.create}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={task ? e.editTitle : e.createTitle}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            id={`task-title-${task?.id ?? 'new'}`}
            name="title"
            label={e.title}
            value={title}
            maxLength={L.titleMax}
            autoComplete="off"
            onChange={(ev) => setTitle(ev.target.value)}
          />
          <TextAreaField
            id={`task-description-${task?.id ?? 'new'}`}
            name="description"
            label={e.description}
            value={description}
            maxLength={L.descriptionMax}
            rows={4}
            onChange={(ev) => setDescription(ev.target.value)}
          />
          <Field
            id={`task-points-${task?.id ?? 'new'}`}
            name="points"
            label={e.points}
            hint={e.pointsNote}
            inputMode="numeric"
            value={points}
            autoComplete="off"
            onChange={(ev) => setPoints(ev.target.value)}
          />
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : e.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
