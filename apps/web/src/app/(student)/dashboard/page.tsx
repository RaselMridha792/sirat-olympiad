import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarClock,
  Save,
  Send,
  ShieldAlert,
  Timer,
  TriangleAlert,
  Trophy,
} from 'lucide-react';
import {
  EXAM_MAX_DURATION_MINUTES,
  formatParticipantId,
  REGISTRATION_STATE_LABELS,
  type AnnouncementItem,
  type StudentHome,
} from '@sirat/shared';
import { Badge, buttonClasses, Card, cn, DetailList } from '@sirat/ui';
import { BookOrderCard } from '@/components/book/BookOrderCard';
import { entryStatusTone, examStateTone, paymentStatusTone } from '@/components/status';
import { getData } from '@/data';
import { isNextControlFlow } from '@/data/http/home';
import type { DataSource } from '@/data/source';
import type { SearchParams } from '@/data/query';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { bookMessages } from '@/i18n/messages/book';
import { studentHomeMessages } from '@/i18n/messages/student-home';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

/*
 * Student home (old dashboard/page.jsx): navy welcome hero with the current-round card, the next
 * exam, the exam rules and the latest announcements. Not ported: the old topic card and the
 * courses button (neither is part of this product).
 */

type HomeMessages = (typeof studentHomeMessages)['en'];
interface Copy {
  locale: Locale;
  m: HomeMessages;
  c: CommonMessages;
}
type CurrentRound = NonNullable<StudentHome['currentRound']>;
type NextExam = StudentHome['nextExam'];

/** Visible focus ring on the navy hero (the default ring is hard to see there). */
const FOCUS_ON_DARK =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const TEXT_LINK =
  'inline-flex min-h-6 items-center gap-1.5 text-sm font-semibold text-secondary hover:underline';

/** Spaced capitals suit Latin labels only: Bangla has no case, and wide tracking hurts legibility. */
function spacedCaps(locale: Locale, tracking: string): string | undefined {
  return locale === 'en' ? cn('uppercase', tracking) : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(studentHomeMessages);
  return { title: m.metaTitle };
}

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(studentHomeMessages),
    getMessages(common),
    getData(params),
  ]);
  const home = await data.student.getHome();
  const copy: Copy = { locale, m, c };
  return (
    <>
      <Hero name={home.user.name} round={home.currentRound} copy={copy} />
      <RegistrationCard registration={home.registration} copy={copy} />
      <BookSection data={data} copy={copy} />
      <NextExamCard exam={home.nextExam} copy={copy} />
      <ExamRules exam={home.nextExam} copy={copy} />
      <LatestAnnouncements items={home.latestAnnouncements} copy={copy} />
    </>
  );
}

/**
 * Payments' book card (#42) reads GET /book-order/me itself. Like every other section of the home it falls back on its
 * own when that read fails, so an outage there never takes the whole home down; Next's redirect and not-found pass.
 */
async function BookSection({ data, copy: { locale, m } }: { data: DataSource; copy: Copy }) {
  try {
    return await BookOrderCard({ data, locale });
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return (
      <Card className="mb-8 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-page text-ink-faint"
        >
          <BookOpen className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-ink">{pick(bookMessages, locale).card.title}</h2>
          <p role="status" className="mt-1 text-sm text-ink-muted">
            {m.book.unavailable}
          </p>
        </div>
      </Card>
    );
  }
}

/**
 * The student's registration and its payment (payments' GET /registrations/me; core C4). A registration exists only
 * for a paid payment (the registrations_payment_paid trigger) and there are no refunds, so a registered student's
 * payment is "paid". Without one the card links to payments' registration; nothing here starts or changes a payment.
 */
function RegistrationCard({
  registration,
  copy: { locale, m, c },
}: {
  registration: StudentHome['registration'];
  copy: Copy;
}) {
  const r = m.registration;
  if (!registration) {
    return (
      <Card className="mb-6">
        <h2 className="text-lg font-bold text-ink">{r.title}</h2>
        <p role="status" className="mt-1 text-sm text-ink-muted">
          {r.unavailable}
        </p>
      </Card>
    );
  }
  if (!registration.registered) {
    return (
      <Card className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">{r.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{r.none}</p>
        </div>
        <Link href="/register" className={buttonClasses({ size: 'sm' })}>
          {r.register}
        </Link>
      </Card>
    );
  }
  const { payment } = registration;
  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{r.title}</h2>
        <Badge tone={paymentStatusTone[payment.status]}>
          {/* payments' own wording, as on their result page */}
          {payment.status === 'paid'
            ? REGISTRATION_STATE_LABELS.completed[locale]
            : c.paymentStatus[payment.status]}
        </Badge>
      </div>
      <DetailList
        items={[
          {
            label: r.participantId,
            value: (
              <span className="font-mono" translate="no">
                {formatParticipantId(registration.participantId)}
              </span>
            ),
          },
          { label: r.registeredOn, value: formatDate(locale, registration.registeredAt) },
          { label: r.payment, value: c.paymentStatus[payment.status] },
          { label: r.invoice, value: <span className="font-mono">{payment.invoiceNumber}</span> },
          {
            label: r.amount,
            value: `${formatNumber(locale, payment.amountMinor / 100)} ${payment.currency}`,
          },
        ]}
      />
    </Card>
  );
}

function Hero({ name, round, copy }: { name: string; round: CurrentRound | null; copy: Copy }) {
  const { locale, m } = copy;
  return (
    <section
      aria-labelledby="home-title"
      className="relative mb-8 overflow-hidden rounded-[2rem] border border-white/10 bg-shell text-white shadow-card md:rounded-[2.5rem]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/5 sm:h-96 sm:w-96"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-white/5"
      />
      <div className="relative flex flex-col gap-10 px-6 py-10 sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-12 lg:px-14 lg:py-14">
        <div className="min-w-0 max-w-2xl flex-1">
          <p
            className={cn(
              'mb-3 text-xs font-bold text-white/70',
              spacedCaps(locale, 'tracking-[0.2em]'),
            )}
          >
            {m.hero.eyebrow}
          </p>
          <h1
            id="home-title"
            className="text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl"
          >
            {m.hero.welcome}
            <span className="mt-1 block break-words text-accent md:mt-2">{name}</span>
          </h1>
          <p className="mt-5 max-w-xl text-sm font-medium leading-relaxed text-white/80 md:text-base">
            {m.hero.lead}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/dashboard/exam"
              className={buttonClasses({
                size: 'lg',
                className: cn('shadow-lg shadow-black/20', FOCUS_ON_DARK),
              })}
            >
              <BookOpen aria-hidden className="h-5 w-5" />
              {m.hero.viewExams}
            </Link>
            <Link
              href="/dashboard/leaderboard"
              className={buttonClasses({
                variant: 'secondary',
                size: 'lg',
                className: cn('border-2 border-white/40', FOCUS_ON_DARK),
              })}
            >
              <Trophy aria-hidden className="h-5 w-5" />
              {m.hero.leaderboard}
            </Link>
          </div>
        </div>
        <RoundCard round={round} copy={copy} />
      </div>
    </section>
  );
}

function roundLine(round: CurrentRound, m: HomeMessages): string {
  if (round.entryStatus === null) return m.round.noEntry;
  if (round.entryStatus === 'pending') return m.round.pending[round.type];
  return m.round.status[round.entryStatus];
}

/** Frosted card on the hero: the round the student is in now and what it means for them. */
function RoundCard({ round, copy }: { round: CurrentRound | null; copy: Copy }) {
  const { locale, m, c } = copy;
  return (
    <div className="relative w-full max-w-sm shrink-0">
      <div
        aria-hidden="true"
        className="absolute -right-4 -top-4 hidden h-24 w-24 rounded-2xl border border-white/10 bg-white/5 sm:block"
      />
      <div className="relative rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur">
        <h2
          className={cn('text-xs font-bold text-white/70', spacedCaps(locale, 'tracking-widest'))}
        >
          {m.round.label}
        </h2>
        {round ? (
          <>
            <p className="mt-2 break-words text-xl font-black md:text-2xl">{round.name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/90">
                {c.roundTypes[round.type]}
              </span>
              {round.entryStatus ? (
                <Badge tone={entryStatusTone[round.entryStatus]}>
                  {c.entryStatus[round.entryStatus]}
                </Badge>
              ) : null}
            </div>
            {round.entryStatus === 'promoted' ? (
              <p className="mt-4 rounded-xl border border-success/40 bg-success/15 px-3 py-2 text-sm font-bold text-white">
                {m.round.status.promoted}
              </p>
            ) : (
              <p className="mt-4 text-sm leading-relaxed text-white/80">{roundLine(round, m)}</p>
            )}
            {round.type === 'video' ? (
              <Link
                href="/dashboard/round"
                className={cn(
                  'mt-4 inline-flex text-sm font-bold text-white underline-offset-4 hover:underline',
                  FOCUS_ON_DARK,
                )}
              >
                {m.round.open}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-2 text-lg font-bold">{m.round.none}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/80">{m.round.noneHint}</p>
          </>
        )}
      </div>
    </div>
  );
}

function NextExamCard({ exam, copy }: { exam: NextExam; copy: Copy }) {
  const { locale, m, c } = copy;
  if (!exam) {
    return (
      <Card className="mb-8 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-page text-ink-faint"
        >
          <CalendarClock className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold text-ink">{m.next.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{m.next.empty}</p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-strong"
          >
            <CalendarClock className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2
              className={cn(
                'text-xs font-bold text-ink-muted',
                spacedCaps(locale, 'tracking-wider'),
              )}
            >
              {m.next.title}
            </h2>
            <p className="mt-1 break-words text-lg font-bold text-ink">{exam.title}</p>
          </div>
        </div>
        <div className="shrink-0">
          <Badge tone={examStateTone[exam.state]}>{c.examState[exam.state]}</Badge>
        </div>
      </div>
      <div className="mt-5">
        <DetailList
          columns={2}
          items={[
            {
              label: m.next.starts,
              value: (
                <time dateTime={exam.windowStart}>{formatDateTime(locale, exam.windowStart)}</time>
              ),
            },
            {
              label: m.next.ends,
              value: (
                <time dateTime={exam.windowEnd}>{formatDateTime(locale, exam.windowEnd)}</time>
              ),
            },
            {
              label: m.next.duration,
              value: m.next.minutes(formatNumber(locale, exam.durationMinutes)),
            },
            { label: m.next.questions, value: formatNumber(locale, exam.questionsPerAttempt) },
          ]}
        />
      </div>
      <Link href="/dashboard/exam" className={cn('mt-5', TEXT_LINK)}>
        {m.next.link}
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
    </Card>
  );
}

/**
 * Old "Important Exam Instructions", rewritten for the new exam model (RULEBOOK §7.1). Numbers come
 * from the next exam's config; without one, only the product maximum duration is stated.
 */
function ExamRules({ exam, copy }: { exam: NextExam; copy: Copy }) {
  const { locale, m } = copy;
  const units = m.rules.units;
  const num = (value: number) => formatNumber(locale, value);
  const attemptBody = exam
    ? m.rules.attempt.body(
        units.minutes(num(exam.durationMinutes), exam.durationMinutes),
        units.questions(num(exam.questionsPerAttempt), exam.questionsPerAttempt),
      )
    : m.rules.attempt.bodyMax(
        units.minutes(num(EXAM_MAX_DURATION_MINUTES), EXAM_MAX_DURATION_MINUTES),
      );
  const submitBody =
    exam && exam.graceSeconds > 0
      ? m.rules.submit.body(units.seconds(num(exam.graceSeconds), exam.graceSeconds))
      : m.rules.submit.bodyNoWait;
  const rules = [
    {
      key: 'attempt',
      title: m.rules.attempt.title,
      body: attemptBody,
      Icon: CalendarClock,
      card: 'border-info/20 bg-info-soft',
      icon: 'text-info',
    },
    {
      key: 'timer',
      title: m.rules.timer.title,
      body: m.rules.timer.body,
      Icon: Timer,
      card: 'border-warning/20 bg-warning-soft',
      icon: 'text-warning',
    },
    {
      key: 'saving',
      title: m.rules.saving.title,
      body: m.rules.saving.body,
      Icon: Save,
      card: 'border-primary/20 bg-primary-soft',
      icon: 'text-primary',
    },
    {
      key: 'submit',
      title: m.rules.submit.title,
      body: submitBody,
      Icon: Send,
      card: 'border-secondary/20 bg-secondary-soft',
      icon: 'text-secondary',
    },
  ];
  return (
    <section aria-labelledby="rules-title" className="mb-8">
      <div className="mb-6 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 rounded-lg bg-warning-soft p-2 text-warning-strong"
        >
          <TriangleAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="rules-title" className="text-xl font-bold text-ink md:text-2xl">
            {m.rules.title}
          </h2>
          <p className="text-sm text-ink-muted">{m.rules.subtitle}</p>
        </div>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 md:gap-6">
        {rules.map(({ key, title, body, Icon, card, icon }) => (
          <li
            key={key}
            className={cn('flex items-start gap-4 rounded-2xl border p-5 md:p-6', card)}
          >
            <span
              aria-hidden="true"
              className="mt-1 shrink-0 rounded-xl bg-surface p-3 shadow-card"
            >
              <Icon className={cn('h-6 w-6', icon)} />
            </span>
            <div className="min-w-0">
              <h3 className="mb-1 text-lg font-bold text-ink">{title}</h3>
              <p className="text-sm font-medium leading-relaxed text-ink/80">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-start gap-4 rounded-r-xl border-l-4 border-danger bg-surface p-5 shadow-card">
        <ShieldAlert aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-danger" />
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{m.rules.fair.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{m.rules.fair.body}</p>
        </div>
      </div>
    </section>
  );
}

function LatestAnnouncements({ items, copy }: { items: AnnouncementItem[]; copy: Copy }) {
  const { locale, m } = copy;
  return (
    <section aria-labelledby="news-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="news-title" className="text-xl font-bold text-ink md:text-2xl">
          {m.news.title}
        </h2>
        <Link href="/dashboard/announcements" className={TEXT_LINK}>
          {m.news.all}
          <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{m.news.empty}</p>
      ) : (
        // Title and body are admin text and may hold a long link: min-w-0 lets the card shrink
        // below that link's width (no sideways scroll on phones) and break-words wraps it.
        <ul className="grid gap-4 lg:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                <Calendar aria-hidden className="h-3.5 w-3.5" />
                <time dateTime={item.publishedAt}>{formatDate(locale, item.publishedAt)}</time>
              </p>
              <h3 className="mt-2 break-words font-bold text-ink">{item.title}</h3>
              <p className="mt-1 line-clamp-2 break-words text-sm leading-relaxed text-ink-muted">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
