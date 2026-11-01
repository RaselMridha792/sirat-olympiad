'use client';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { TEAM_LIMITS as L } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminTeamsMessages } from '@/i18n/messages/admin-teams';
import { teamMessages } from '@/i18n/messages/team';
import { useTeamAction } from '../team/use-team-action';

/** An admin renames a team (moderation, core C5b-3): PATCH /api/admin/teams/:id with a reason and the version seen. */
export function RenameTeamButton({
  locale,
  teamId,
  name,
  updatedAt,
}: {
  locale: Locale;
  teamId: string;
  name: string;
  updatedAt: string;
}) {
  const m = pick(adminTeamsMessages, locale).rename;
  const t = pick(teamMessages, locale);
  const { pending, problem, setProblem, run } = useTeamAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [reason, setReason] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = value.trim();
    const why = reason.trim();
    if (
      next.length < L.nameMin ||
      next.length > L.nameMax ||
      why.length < L.reasonMin ||
      why.length > L.reasonMax
    ) {
      setProblem('invalid');
      return;
    }
    const done = await run(`/admin/teams/${encodeURIComponent(teamId)}`, 'PATCH', {
      name: next,
      reason: why,
      expectedUpdatedAt: updatedAt,
    });
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setProblem(null);
          setValue(name);
          setReason('');
          setOpen(true);
        }}
      >
        <Pencil aria-hidden="true" size={16} />
        {m.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.title}
        closeLabel={t.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.text}</p>
          <Field
            id={`team-rename-${teamId}`}
            name="name"
            label={m.name}
            value={value}
            maxLength={L.nameMax}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
          />
          <Field
            id={`team-reason-${teamId}`}
            name="reason"
            label={m.reason}
            value={reason}
            maxLength={L.reasonMax}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
          />
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {t.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t.pending : m.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
