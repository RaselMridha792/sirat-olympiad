'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button, Dialog } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { teamMessages } from '@/i18n/messages/team';
import { useTeamAction } from './use-team-action';

/** "Leave this team" (not for the team lead); POST /api/teams/mine/leave through api(). */
export function LeaveTeamButton({ locale }: { locale: Locale }) {
  const m = pick(teamMessages, locale);
  const { pending, problem, setProblem, run } = useTeamAction();
  const [open, setOpen] = useState(false);

  async function confirm() {
    if (await run('/teams/mine/leave', 'POST')) setOpen(false);
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
        <LogOut aria-hidden="true" size={16} />
        {m.team.leave}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.team.leaveTitle}
        closeLabel={m.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{m.team.leaveText}</p>
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={confirm} disabled={pending}>
              {pending ? m.pending : m.team.confirmLeave}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
