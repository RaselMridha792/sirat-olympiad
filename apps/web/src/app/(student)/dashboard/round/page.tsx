import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@sirat/ui';
import { videoWindow } from '@/components/round/round-window';
import { VideoForm } from '@/components/round/VideoForm';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime } from '@/i18n/format';
import { studentRoundMessages } from '@/i18n/messages/student-round';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(studentRoundMessages);
  return { title: m.title };
}

/**
 * The student's round (core C6b): the round, the window, the own status and, in a video round, the video link (sent
 * and shown back as text; changeable while the window is open). Scores and the jury's notes are never shown here.
 */
export default async function RoundPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAccess('/dashboard/round');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(studentRoundMessages),
    getMessages(common),
    getData(params),
  ]);
  const mine = await data.student.getMyRound();
  const header = <PageHeader title={m.title} subtitle={m.subtitle} />;
  if (!mine)
    return (
      <>
        {header}
        <EmptyState
          icon={<Flag aria-hidden="true" size={24} />}
          title={m.none.title}
          description={m.none.text}
        />
      </>
    );

  const { round, entryStatus } = mine;
  const state = videoWindow(mine);

  return (
    <>
      {header}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black text-ink">{round.name}</h2>
          <Badge tone="brand">{c.roundTypes[round.type]}</Badge>
        </div>
        {round.type === 'quiz' ? null : (
          <p className="text-sm text-ink-muted">
            {round.opensAt && round.closesAt
              ? m.window(
                  formatDateTime(locale, round.opensAt),
                  formatDateTime(locale, round.closesAt),
                )
              : m.noWindow}
          </p>
        )}
        <p className="text-sm text-ink">
          {m.status}:{' '}
          {entryStatus ? (
            <span className="font-semibold">{c.entryStatus[entryStatus]}</span>
          ) : (
            <span className="text-ink-muted">{m.notInRound}</span>
          )}
        </p>
      </Card>

      {round.type === 'video' && entryStatus !== null ? (
        <Card className="mt-6 flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">{m.video.title}</h2>
          <p className="text-sm text-ink-muted">{m.video.text}</p>
          {mine.videoUrl ? (
            <div className="rounded-control border border-line bg-page p-3 text-sm">
              <p className="text-ink-muted">{m.video.current}</p>
              {/* As text, never a link: it is the student's own input (lead). */}
              <p className="mt-1 break-all font-mono text-ink">{mine.videoUrl}</p>
              {mine.videoSubmittedAt ? (
                <p className="mt-1 text-xs text-ink-faint">
                  {m.video.sentAt(formatDateTime(locale, mine.videoSubmittedAt))}
                </p>
              ) : null}
            </div>
          ) : null}
          {state === 'open' ? (
            <VideoForm locale={locale} roundId={round.id} sent={mine.videoUrl !== null} />
          ) : state === 'notYet' && round.opensAt ? (
            <p className="text-sm text-ink-muted">
              {m.video.notOpen(formatDateTime(locale, round.opensAt))}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">{m.video.closed}</p>
          )}
        </Card>
      ) : null}
    </>
  );
}
