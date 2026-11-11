import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowUpRight, Hourglass, Info, UserCheck } from 'lucide-react';
import { Badge, Card, EmptyState } from '@sirat/ui';
import { AdmitIdBox } from '@/components/admit-card/AdmitIdBox';
import { DownloadAdmitPdf } from '@/components/admit-card/DownloadAdmitPdf';
import { ExamCountdown } from '@/components/admit-card/ExamCountdown';
import { ShareAdmitCard } from '@/components/admit-card/ShareAdmitCard';
import siratMark from '@/components/public/sirat-mark.png';
import { OFFICIAL_GROUP_KEYS, officialGroups } from '@/content/groups';
import { safeExternalUrl } from '@/content/home';
import { site } from '@/content/site';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { intlTag, TIME_ZONE } from '@/i18n/config';
import { formatDate, formatNumber } from '@/i18n/format';
import { admitCardMessages } from '@/i18n/messages/admit-card';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(admitCardMessages);
  return { title: m.title };
}

/**
 * The admit card (প্রবেশপত্র; core A1, the client's mock-up, the lead's approval of 2026-11-11): the participant ID in
 * full (this page only: it is the login secret) with copy and a keep-private note, the candidate's details, the exam
 * date from exam's next round exam, a countdown, the official group links, a share image with the ID masked, and the
 * PDF (A2: the worker's print copy with the full ID, never the email).
 */
export default async function AdmitCardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/admit-card');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(admitCardMessages),
    getMessages(common),
    getData(params),
  ]);
  const card = await data.student.getAdmitCard();

  if (!card)
    return (
      <EmptyState
        icon={<UserCheck size={28} />}
        title={m.notRegistered.title}
        description={m.notRegistered.text}
      />
    );

  const day = (iso: string) =>
    new Intl.DateTimeFormat(intlTag(locale), {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intlTag(locale), {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  const category = card.category ? c.categories[card.category] : c.notProvided;
  const examDay = card.exam ? day(card.exam.windowStart) : m.examSoon;
  const fee = `৳${formatNumber(locale, card.fee.amountMinor / 100)}`;
  const groups = OFFICIAL_GROUP_KEYS.map((key) => ({
    key,
    url: safeExternalUrl(officialGroups[key]),
    ...m.groups.items[key],
  })).filter((g) => g.url !== null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft p-1">
              <Image src={siratMark} alt="" width={36} height={36} unoptimized />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-ink">{m.title}</h1>
              <p className="text-sm text-ink-muted">{site.name[locale]}</p>
            </div>
          </div>
          <Badge tone="warning">{m.mode[card.mode]}</Badge>
        </div>

        <AdmitIdBox
          participantId={card.participantId}
          label={m.idLabel}
          registered={m.registered}
          keepPrivate={m.keepPrivate}
          copyLabel={m.copy}
          copiedLabel={m.copied}
          failedLabel={m.copyFailed}
        />

        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={m.fields.name} value={card.name} />
          <Field label={m.fields.category} value={category} />
          <Field
            label={m.fields.exam}
            value={examDay}
            sub={
              card.exam
                ? m.examTime(time(card.exam.windowStart), time(card.exam.windowEnd))
                : undefined
            }
          />
          <Field label={m.fields.classFee} value={card.gradeLevel ?? c.notProvided} sub={fee} />
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <DownloadAdmitPdf locale={locale} labels={m.pdf} />
          <ShareAdmitCard
            label={m.share}
            hint={m.shareHint}
            failed={m.shareFailed}
            text={{
              siteName: site.name[locale],
              heading: m.imageHeading,
              name: card.name,
              lines: [
                category,
                card.exam ? `${examDay}, ${time(card.exam.windowStart)}` : m.examSoon,
              ],
              idLabel: m.imageId,
              // The server-masked form only: the full ID never goes into the image.
              idMasked: card.participantIdMasked,
            }}
          />
        </div>
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-black text-ink">
              <Hourglass aria-hidden="true" size={18} className="text-accent-strong" />
              {m.countdown.title}
            </h2>
            {card.exam ? (
              <span className="text-xs text-ink-muted">
                {formatDate(locale, card.exam.windowStart)}
              </span>
            ) : null}
          </div>
          {card.exam ? (
            <ExamCountdown
              startsAt={card.exam.windowStart}
              numberLocale={intlTag(locale)}
              units={m.countdown.units}
              startsAtText={m.countdown.startsAt(`${examDay}, ${time(card.exam.windowStart)}`)}
              startedText={m.countdown.started}
            />
          ) : (
            <p className="text-sm text-ink-muted">{m.countdown.soon}</p>
          )}
          <p className="flex gap-2 rounded-control bg-warning-soft p-3 text-sm text-warning-strong">
            <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
            <span>{card.mode === 'offline' ? m.countdown.offline : m.countdown.online}</span>
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-black text-ink">{m.groups.title}</h2>
          {groups.length === 0 ? (
            <p className="text-sm text-ink-muted">{m.groups.soon}</p>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((g) => (
                <li key={g.key}>
                  <a
                    href={g.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={m.groups.opens(g.title)}
                    className="flex min-h-12 items-center justify-between gap-3 py-2 text-ink hover:text-primary-strong"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{g.title}</span>
                      <span className="block text-xs text-ink-muted">{g.text}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" size={18} className="shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line p-4">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-lg font-bold text-ink">{value}</dd>
      {sub ? <dd className="mt-0.5 text-sm text-ink-muted">{sub}</dd> : null}
    </div>
  );
}
