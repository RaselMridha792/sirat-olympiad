'use client';
import { useState } from 'react';
import { Button, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { teamMessages } from '@/i18n/messages/team';
import { useTeamAction } from './use-team-action';

const CODE = /^TM-[0-9A-Z]{6}$/i;

/** Join with the team's code (any letter case); POST /api/teams/join through api(). */
export function JoinTeamForm({ locale }: { locale: Locale }) {
  const m = pick(teamMessages, locale);
  const { pending, problem, setProblem, run } = useTeamAction();
  const [code, setCode] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = code.trim();
    if (!CODE.test(value)) {
      setProblem('invalid');
      return;
    }
    if (await run('/teams/join', 'POST', { code: value })) setCode('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
      <div className="sm:w-64">
        <Field
          id="team-code"
          name="code"
          label={m.join.code}
          value={code}
          maxLength={9}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          error={problem ? m.errors[problem] : undefined}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? m.pending : m.join.submit}
      </Button>
    </form>
  );
}
