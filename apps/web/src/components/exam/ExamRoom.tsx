'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  ListChecks,
  ShieldAlert,
} from 'lucide-react';
import type { AttemptView, SubmissionReceipt } from '@sirat/shared';
import { Badge, Button, buttonClasses, Card, cn, Countdown, Dialog } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { examPlayerMessages, type ExamPlayerMessages } from '@/i18n/messages/exam-player';
import { loginUrl } from '@/lib/auth/next-param';
import { classifyFailure, newRequestId, playerApi, refusalCode } from './exam-api';
import {
  ExamController,
  type Connection,
  type ExamDeps,
  type PlayerState,
} from './exam-controller';
import { browserStore } from './exam-storage';
import type { RoomExam } from './room-exam';
import { isDevtoolsKey, LeaveTracker, type PageSignal } from './violations';

/*
 * The exam room (old app/quiz/page.jsx and QuizePageComponents; EXAM-PLAN 4, owner Q4): waiting room, rules, the
 * player and the receipt. The look is the old one on our tokens; the rules are ours. The server decides the time,
 * the questions and every refusal; ExamController keeps the answers in the browser, sends the checkpoints and the
 * one submit. Nothing here ever sees a correct answer or a score: the API sends neither before results are published.
 */

const EXAM_PATH = '/dashboard/exam';

type Stage =
  | { kind: 'waiting' }
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'player'; controller: ExamController; questions: AttemptView['questions'] };

function browserDeps(): ExamDeps {
  return {
    api: playerApi,
    store: browserStore(),
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    random: () => Math.random(),
    uuid: newRequestId,
    classify: classifyFailure,
  };
}

export function ExamRoom({ locale, exam }: { locale: Locale; exam: RoomExam }) {
  const m = pick(examPlayerMessages, locale);
  const resuming = exam.attempt?.phase === 'in_progress';
  const [stage, setStage] = useState<Stage>(resuming ? { kind: 'loading' } : { kind: 'waiting' });

  const open = useCallback(
    (view: AttemptView) => {
      const controller = new ExamController(view, browserDeps(), exam.durationMinutes * 60);
      setStage({ kind: 'player', controller, questions: view.questions });
    },
    [exam.durationMinutes],
  );

  const enter = useCallback(
    async (how: 'start' | 'resume') => {
      setStage({ kind: 'loading' });
      try {
        open(await (how === 'start' ? playerApi.start(exam.id) : playerApi.resume(exam.id)));
      } catch (error) {
        setStage({ kind: 'error', code: refusalCode(error) });
      }
    },
    [exam.id, open],
  );

  // A reload or a return during the exam goes straight back in (the rules were accepted at the start).
  useEffect(() => {
    if (!resuming) return;
    let cancelled = false;
    playerApi.resume(exam.id).then(
      (view) => {
        if (!cancelled) open(view);
      },
      (error: unknown) => {
        if (!cancelled) setStage({ kind: 'error', code: refusalCode(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [resuming, exam.id, open]);

  switch (stage.kind) {
    case 'player':
      return (
        <Player
          controller={stage.controller}
          questions={stage.questions}
          examId={exam.id}
          locale={locale}
          m={m}
        />
      );
    case 'loading':
      return (
        <Card className="mx-auto max-w-2xl text-center" aria-busy="true">
          <p className="text-sm font-medium text-ink-muted">{m.loading}</p>
        </Card>
      );
    case 'error':
      return (
        <Card className="mx-auto max-w-2xl space-y-4 text-center">
          <p role="alert" className="font-semibold text-danger-strong">
            {errorText(m, stage.code)}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => setStage({ kind: 'waiting' })}>
              {m.errors.retry}
            </Button>
            <Link href={EXAM_PATH} className={buttonClasses({ variant: 'ghost' })}>
              {m.receipt.back}
            </Link>
          </div>
        </Card>
      );
    case 'waiting':
      return <WaitingRoom exam={exam} locale={locale} m={m} onEnter={enter} />;
  }
}

function errorText(m: ExamPlayerMessages, code: string | null): string {
  switch (code) {
    case 'not_open_yet':
    case 'window_closed':
    case 'email_unverified':
    case 'registration_required':
    case 'account_blocked':
      return m.errors[code];
    case 'already_submitted':
      return m.closed.already_submitted;
    case 'time_over':
      return m.closed.time_over;
    default:
      return m.errors.generic;
  }
}

// ───────────── Waiting room and rules ─────────────

function WaitingRoom({
  exam,
  locale,
  m,
  onEnter,
}: {
  exam: RoomExam;
  locale: Locale;
  m: ExamPlayerMessages;
  onEnter: (how: 'start' | 'resume') => void;
}) {
  // From the server's clock at render time, never the device's.
  const [opensIn] = useState(() =>
    Math.ceil((Date.parse(exam.windowStart) - Date.parse(exam.serverNow)) / 1000),
  );
  const [openNow, setOpenNow] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const onOpened = useCallback(() => setOpenNow(true), []);
  // A click before React runs would do nothing: the button waits for hydration, like the auth forms.
  const hydrated = useHydrated();
  const n = (v: number) => formatNumber(locale, v);

  if (exam.state === 'submitted' && exam.attempt?.receipt) {
    return <Receipt receipt={exam.attempt.receipt} locale={locale} m={m} />;
  }
  if (exam.state === 'closed' || exam.state === 'submitted') {
    return (
      <Notice tone="neutral" back={m.receipt.back}>
        {exam.attempt?.phase === 'time_over' ? m.closed.time_over : m.waiting.closed}
      </Notice>
    );
  }

  const canStart = exam.state === 'open' || exam.state === 'in_progress' || openNow;
  return (
    <Card className="mx-auto max-w-2xl space-y-5">
      {canStart ? null : (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">
            {m.waiting.opensAt(formatDateTime(locale, exam.windowStart))}
          </p>
          <div className="flex items-center gap-2 text-primary-strong">
            <Clock aria-hidden className="h-5 w-5" />
            <span className="text-sm font-semibold text-ink-muted">{m.waiting.opensIn}</span>
            <Countdown remainingSeconds={opensIn} onZero={onOpened} />
          </div>
          <p className="text-xs text-ink-muted">{m.waiting.notYet}</p>
        </div>
      )}
      <Button
        size="lg"
        disabled={!canStart || !hydrated}
        onClick={() => (exam.state === 'in_progress' ? onEnter('resume') : setRulesOpen(true))}
      >
        {exam.state === 'in_progress' ? m.waiting.continue : m.waiting.start}
      </Button>
      <Rules
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        onStart={() => {
          setRulesOpen(false);
          onEnter('start');
        }}
        minutes={n(exam.durationMinutes)}
        questions={n(exam.questionsPerAttempt)}
        warnings={exam.violationWarnings}
        locale={locale}
        m={m}
      />
    </Card>
  );
}

function Rules({
  open,
  onClose,
  onStart,
  minutes,
  questions,
  warnings,
  locale,
  m,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  minutes: string;
  questions: string;
  warnings: number;
  locale: Locale;
  m: ExamPlayerMessages;
}) {
  const [agreed, setAgreed] = useState(false);
  const r = m.rules;
  const lines = [
    r.duration(minutes),
    r.questions(questions),
    r.saved,
    r.leave,
    r.end(formatNumber(locale, warnings), formatNumber(locale, warnings + 1)),
    r.recorded,
    r.phone,
    r.timeUp,
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={r.title}
      closeLabel={r.cancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {r.cancel}
          </Button>
          <Button disabled={!agreed} onClick={onStart}>
            {r.start}
          </Button>
        </div>
      }
    >
      <ul className="list-disc space-y-2 ps-5 text-sm leading-relaxed text-ink">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <label className="mt-5 flex items-center gap-3 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {r.agree}
      </label>
    </Dialog>
  );
}

// ───────────── The player ─────────────

const CONNECTION_TONE: Record<Connection, 'success' | 'info' | 'warning' | 'danger'> = {
  saved: 'success',
  saving: 'info',
  unsaved: 'warning',
  offline: 'danger',
};

function Player({
  controller,
  questions,
  examId,
  locale,
  m,
}: {
  controller: ExamController;
  questions: AttemptView['questions'];
  examId: string;
  locale: Locale;
  m: ExamPlayerMessages;
}) {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [index, setIndex] = useState(() => Math.max(0, state.answers.indexOf(null)));
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    controller.start();
    return () => controller.destroy();
  }, [controller]);

  useEffect(() => watchViolations(controller), [controller]);

  if (state.phase === 'submitted' && state.receipt) {
    return <Receipt receipt={state.receipt} locale={locale} m={m} />;
  }
  if (state.phase === 'closed' || state.phase === 'submitted') {
    return <Closed reason={state.closedReason} examId={examId} m={m} />;
  }
  if (state.phase === 'ending') {
    return <Ending state={state} m={m} />;
  }

  const n = (v: number) => formatNumber(locale, v);
  const total = questions.length;
  const question = questions[index];
  const answered = state.answers.filter((a) => a !== null).length;
  const isLast = index === total - 1;
  return (
    <>
      <div
        className={cn(
          'mx-auto flex max-w-5xl select-none flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition',
          state.phase === 'warning' && 'blur-sm grayscale',
        )}
        translate="no"
        onContextMenu={(e) => e.preventDefault()}
      >
        <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:px-8 md:py-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-control border border-line bg-page px-3 py-1.5 text-primary-strong">
                <Clock aria-hidden className="h-5 w-5" />
                <span className="sr-only">{m.player.timeLeft}</span>
                <TimeLeft controller={controller} endsAt={state.endsAt} />
              </div>
              <Badge tone={CONNECTION_TONE[state.connection]}>
                {m.player.connection[state.connection]}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {state.violationCount > 0 ? (
                <Badge tone="danger">
                  {m.player.warnings(n(state.violationCount), n(state.warnings))}
                </Badge>
              ) : null}
              <span className="rounded-control border border-line bg-page px-3 py-1.5 text-sm font-bold text-ink-muted">
                {n(index + 1)}/{n(total)}
              </span>
            </div>
          </div>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-page"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answered}
            aria-valuetext={m.player.answered(n(answered), n(total))}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
            />
          </div>
        </header>

        <section className="min-h-72 px-4 py-6 md:px-10 md:py-10">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
            {m.player.question(n(index + 1), n(total))}
          </p>
          {question ? (
            <QuestionCard
              text={question.text}
              options={question.options}
              selected={state.answers[index] ?? null}
              letters={m.letters}
              onSelect={(position) => controller.answer(index, position)}
            />
          ) : null}
        </section>

        <footer className="flex items-center justify-between gap-2 border-t border-line bg-page/60 px-4 py-3 md:px-10 md:py-6">
          <Button
            variant="outline"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
            {m.player.previous}
          </Button>
          {isLast ? (
            <Button onClick={() => setConfirmOpen(true)}>{m.player.submit}</Button>
          ) : (
            <Button onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>
              {m.player.next}
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          )}
        </footer>
      </div>

      <nav
        aria-label={m.player.list}
        className={cn(
          'mx-auto mt-5 max-w-5xl rounded-card border border-line bg-surface p-4 shadow-card md:p-6',
          state.phase === 'warning' && 'blur-sm grayscale',
        )}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
            <ListChecks aria-hidden className="h-4 w-4" />
            {m.player.list}
          </h2>
          <span className="text-xs font-semibold text-ink-muted">
            {m.player.answered(n(answered), n(total))}
          </span>
        </div>
        <ol className="flex flex-wrap gap-2">
          {questions.map((_, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? 'step' : undefined}
                className={cn(
                  'h-9 w-9 rounded-control border text-sm font-bold transition-colors',
                  state.answers[i] !== null && state.answers[i] !== undefined
                    ? 'border-primary/30 bg-primary-soft text-primary-strong'
                    : 'border-line bg-surface text-ink-muted hover:border-primary/40',
                  i === index && 'ring-2 ring-primary ring-offset-1',
                )}
              >
                {n(i + 1)}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            {m.player.submit}
          </Button>
        </div>
      </nav>

      <Dialog
        open={state.phase === 'warning'}
        onClose={() => controller.dismissWarning()}
        title={m.warning.title(n(state.violationCount), n(state.warnings))}
        closeLabel={m.warning.back}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => controller.dismissWarning()}>{m.warning.back}</Button>
          </div>
        }
      >
        <div className="flex gap-3">
          <ShieldAlert aria-hidden className="h-6 w-6 shrink-0 text-danger" />
          <div className="space-y-2 text-sm text-ink">
            <p className="font-semibold">
              {state.lastViolation === 'devtools' ? m.warning.devtools : m.warning.leave}
            </p>
            <p>
              {state.warnings + 1 - state.violationCount <= 1
                ? m.warning.last
                : m.warning.left(n(state.warnings + 1 - state.violationCount))}
            </p>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={m.confirm.title}
        closeLabel={m.confirm.back}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {m.confirm.back}
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                controller.finish();
              }}
            >
              {m.confirm.submit}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm text-ink">
          <p className="font-semibold">
            {total - answered > 0
              ? m.confirm.unanswered(n(total - answered))
              : m.confirm.allAnswered}
          </p>
          <p className="text-ink-muted">{m.confirm.body}</p>
        </div>
      </Dialog>
    </>
  );
}

/** The countdown re-syncs only when the server moves ends_at; the controller's own timer ends the exam. */
function TimeLeft({ controller, endsAt }: { controller: ExamController; endsAt: number }) {
  const remaining = useMemo(() => controller.remainingSeconds(endsAt), [controller, endsAt]);
  return <Countdown remainingSeconds={remaining} />;
}

function QuestionCard({
  text,
  options,
  selected,
  letters,
  onSelect,
}: {
  text: string;
  options: string[];
  selected: number | null;
  letters: readonly string[];
  onSelect: (position: number) => void;
}) {
  return (
    <div className="space-y-5 md:space-y-7">
      <h2 className="break-words text-lg font-bold leading-snug text-ink md:text-2xl">{text}</h2>
      <div
        role="radiogroup"
        aria-label={text}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4"
      >
        {options.map((option, position) => {
          const isSelected = selected === position;
          return (
            <button
              key={position}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(position)}
              className={cn(
                'group flex items-center gap-3 rounded-card border-2 p-3 text-start transition-colors md:gap-4 md:p-5',
                isSelected
                  ? 'border-primary bg-primary-soft ring-2 ring-primary/20'
                  : 'border-line bg-page hover:border-primary/40 hover:bg-surface',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-sm font-bold',
                  isSelected
                    ? 'bg-primary-strong text-white'
                    : 'border border-line bg-surface text-ink-muted group-hover:text-primary-strong',
                )}
              >
                {letters[position] ?? position + 1}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-sm font-medium leading-snug md:text-base',
                  isSelected ? 'text-primary-strong' : 'text-ink',
                )}
              >
                {option}
              </span>
              {isSelected ? (
                <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0 text-primary-strong" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The browser side of the violation rule (owner Q4): leaving the page (blur, hidden) and the developer-tools keys
 * go to the controller; reloading or closing the page does not count; the network going and coming is only logged.
 */
function watchViolations(controller: ExamController): () => void {
  const tracker = new LeaveTracker();
  const active = () => {
    const phase = controller.getState().phase;
    return phase === 'running' || phase === 'warning';
  };
  const signal = (kind: PageSignal) => {
    const result = tracker.signal(kind, active());
    if (result === 'leave') controller.violation('leave');
    else if (result === 'return') controller.note('return');
  };
  const onBlur = () => signal('blur');
  const onFocus = () => signal('focus');
  const onVisibility = () => signal(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
  const onUnload = () => signal('unloading');
  const onKey = (e: KeyboardEvent) => {
    if (!isDevtoolsKey(e)) return;
    e.preventDefault();
    controller.violation('devtools');
  };
  const onOnline = () => controller.note('online');
  const onOffline = () => controller.note('offline');

  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onUnload);
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onUnload);
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

// ───────────── After the exam ─────────────

function Ending({ state, m }: { state: PlayerState; m: ExamPlayerMessages }) {
  const reason = state.endReason ?? 'submitted';
  const titles = {
    violations: m.ending.violations,
    time_up: m.ending.time_up,
    submitted: m.ending.submitted,
  };
  const bodies = {
    violations: m.ending.violationsBody,
    time_up: m.ending.time_upBody,
    submitted: m.ending.submittedBody,
  };
  return (
    <Card className="mx-auto max-w-2xl space-y-3 text-center" aria-live="polite" aria-busy="true">
      <h2 className="text-xl font-bold text-ink">{titles[reason]}</h2>
      <p className="text-sm text-ink-muted">{bodies[reason]}</p>
      {state.connection === 'offline' ? (
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-warning-strong">
          <CloudOff aria-hidden className="h-4 w-4" />
          {m.ending.retrying}
        </p>
      ) : null}
    </Card>
  );
}

function Receipt({
  receipt,
  locale,
  m,
}: {
  receipt: SubmissionReceipt;
  locale: Locale;
  m: ExamPlayerMessages;
}) {
  return (
    <Card className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <CheckCircle2 aria-hidden className="h-8 w-8 shrink-0 text-success" />
        <h2 className="text-xl font-bold text-ink">{m.receipt.title}</h2>
      </div>
      <p className="text-sm text-ink">{m.receipt.reason[receipt.endReason]}</p>
      <dl className="grid gap-2 rounded-control border border-line bg-page p-4 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold text-ink-muted">{m.receipt.id}</dt>
        <dd className="break-all font-mono text-ink">{receipt.receiptId}</dd>
        <dt className="font-semibold text-ink-muted">{m.receipt.at}</dt>
        <dd className="text-ink">
          <time dateTime={receipt.submittedAt}>{formatDateTime(locale, receipt.submittedAt)}</time>
        </dd>
      </dl>
      <p className="text-xs text-ink-muted">{m.receipt.results}</p>
      <Link href={EXAM_PATH} className={buttonClasses({ variant: 'outline' })}>
        {m.receipt.back}
      </Link>
    </Card>
  );
}

function Closed({
  reason,
  examId,
  m,
}: {
  reason: string | null;
  examId: string;
  m: ExamPlayerMessages;
}) {
  if (reason === 'session') {
    return (
      <Notice tone="warning">
        <span className="block">{m.closed.session}</span>
        <Link
          href={loginUrl(`${EXAM_PATH}/${encodeURIComponent(examId)}`)}
          className={buttonClasses({ className: 'mt-4' })}
        >
          {m.closed.login}
        </Link>
      </Notice>
    );
  }
  return (
    <Notice tone="neutral" back={m.receipt.back}>
      {reason === 'already_submitted' ? m.closed.already_submitted : m.closed.time_over}
    </Notice>
  );
}

function Notice({
  tone,
  back,
  children,
}: {
  tone: 'neutral' | 'warning';
  back?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        'mx-auto max-w-2xl text-center text-sm font-medium',
        tone === 'warning' ? 'border-warning/40 bg-warning-soft text-ink' : 'text-ink',
      )}
    >
      <p>{children}</p>
      {back ? (
        <Link href={EXAM_PATH} className={buttonClasses({ variant: 'outline', className: 'mt-4' })}>
          {back}
        </Link>
      ) : null}
    </Card>
  );
}
