'use client';
import { useState } from 'react';
import { UsersRound } from 'lucide-react';
import { TEAM_LIMITS as L } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { teamMessages } from '@/i18n/messages/team';
import { useTeamAction } from './use-team-action';

/** "Create a team" for an approved ambassador (one team each); POST /api/ambassador/teams through api(). */
export function CreateTeamButton({ locale }: { locale: Locale }) {
  const m = pick(teamMessages, locale);
  const { pending, problem, setProblem, run } = useTeamAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < L.nameMin || value.length > L.nameMax) {
      setProblem('invalid');
      return;
    }
    if (await run('/ambassador/teams', 'POST', { name: value })) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
      >
        <UsersRound aria-hidden="true" size={16} />
        {m.create.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.create.title}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.create.text}</p>
          <Field
            id="team-name"
            name="name"
            label={m.create.name}
            hint={m.create.nameHint}
            value={name}
            maxLength={L.nameMax}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
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
              {pending ? m.pending : m.create.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
