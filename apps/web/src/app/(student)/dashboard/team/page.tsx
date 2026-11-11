import type { Metadata } from 'next';
import { Crown, UsersRound } from 'lucide-react';
import { Badge, Card, PageHeader } from '@sirat/ui';
import { CopyCode } from '@/components/ambassador/CopyCode';
import { CreateTeamButton } from '@/components/team/CreateTeamButton';
import { JoinTeamForm } from '@/components/team/JoinTeamForm';
import { LeaveTeamButton } from '@/components/team/LeaveTeamButton';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { formatNumber } from '@/i18n/format';
import { teamMessages } from '@/i18n/messages/team';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(teamMessages);
  return { title: m.title };
}

/**
 * "My team" (core C5b-3; students and ambassadors): join with a code, see the team (first names only: the members
 * are minors), leave it; an ambassador without a team can start one and sees its code to share.
 */
export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireAccess('/dashboard/team');
  const params = await searchParams;
  const [{ locale, m }, data] = await Promise.all([getMessages(teamMessages), getData(params)]);
  const team = await data.student.getMyTeam();
  const n = (value: number) => formatNumber(locale, value);

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      {team ? (
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-xl font-black text-ink">
                <UsersRound aria-hidden="true" size={22} className="text-secondary" />
                {team.name}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{m.team.members(n(team.memberCount))}</p>
            </div>
            {team.isOwner ? null : <LeaveTeamButton locale={locale} />}
          </div>
          {team.isOwner && team.joinCode ? (
            <div className="rounded-control border border-line bg-page p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {m.team.code}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-mono text-lg font-black text-ink">{team.joinCode}</span>
                <CopyCode
                  code={team.joinCode}
                  label={m.team.copy}
                  copiedLabel={m.team.copied}
                  failedLabel={m.team.copyFailed}
                />
              </div>
              <p className="mt-2 text-xs text-ink-faint">{m.team.codeHint}</p>
            </div>
          ) : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {team.members.map((member, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-control border border-line px-3 py-2 text-sm text-ink"
              >
                <span>{member.firstName}</span>
                {member.isOwner ? (
                  <Badge tone="brand">
                    <span className="inline-flex items-center gap-1">
                      <Crown aria-hidden="true" size={12} />
                      {m.team.owner}
                    </span>
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        // An ambassador's next step is to start a team, so that card comes first for them; a student only joins.
        <div className="grid gap-6 lg:grid-cols-2">
          {user.role === 'ambassador' ? (
            <Card className="flex flex-col items-start gap-3">
              <h2 className="text-lg font-bold text-ink">{m.create.title}</h2>
              <p className="text-sm text-ink-muted">{m.create.text}</p>
              <CreateTeamButton locale={locale} />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{m.join.title}</h2>
            <p className="text-sm text-ink-muted">{m.join.text}</p>
            <JoinTeamForm locale={locale} />
          </Card>
        </div>
      )}
    </>
  );
}
