'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  CloudOff,
  LifeBuoy,
  Loader2,
  SearchX,
} from 'lucide-react';
import type { CurrentRegistration } from '@sirat/shared';
import { Button, buttonClasses, DetailList } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { registrationMessages } from '@/i18n/messages/registration';
import { ApiRequestError } from '@/lib/api';
import { BOOK_LOGIN_HREF } from './links';
import { isMoving, nextPollDelay } from './poll';
import { goToCheckout, registrationApi } from './registration-api';
import { problemText, registrationProblem } from './registration-problem';

type Phase = 'loading' | 'ready' | 'none' | 'error';

const ICONS = {
  awaiting_payment: Clock,
  confirming: Loader2,
  completed: CheckCircle2,
  failed: CircleAlert,
  expired: Clock,
  needs_help: LifeBuoy,
} as const;

/**
 * Where PayStation sends the student back to (the API's callback answers 303 here, APP_URL + /register/result). The
 * page never reads a result from the URL: it asks GET /registrations/current (the `sirat_reg` cookie) every 2 s,
 * then 5 s, then 10 s, for 2 minutes (plan 6.7). Then "Check my payment status" asks the worker to ask PayStation
 * again (POST current/recheck) and starts the schedule over. A transient error keeps the schedule going.
 */
export function PaymentResult({ locale }: { locale: Locale }) {
  const m = pick(registrationMessages, locale);
  const r = m.result;
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [current, setCurrent] = useState<CurrentRegistration | null>(null);
  const [round, setRound] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [rechecked, setRechecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    async function tick() {
      try {
        const next = await registrationApi.current();
        if (!live) return;
        setCurrent(next);
        setPhase('ready');
        if (!isMoving(next.state)) return; // settled: nothing more will change by itself
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          setPhase('none');
          return;
        }
        setPhase((p) => (p === 'ready' ? p : 'error'));
      }
      const delay = nextPollDelay(Date.now() - started);
      if (delay === null) {
        setStopped(true);
        return;
      }
      timer = setTimeout(() => void tick(), delay);
    }

    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [round]);

  async function act(call: () => Promise<{ paymentUrl: string } | void>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      const result = await call();
      if (result && goToCheckout(result.paymentUrl)) return; // stay busy while PayStation loads
      after?.();
    } catch (err) {
      const problem = registrationProblem(
        err instanceof ApiRequestError ? { status: err.status, body: err.body } : null,
      );
      setActionError(
        problem.kind === 'form' ? problemText(m, problem.text) : m.errors.PAYMENT_START_FAILED,
      );
      // The API gave the attempt up (its form was cleared after 30 days, D6): read it again, so the page offers
      // a new registration instead of buttons that no longer apply.
      if (problem.kind === 'form' && problem.text === 'START_OVER') restart();
    }
    setBusy(false);
  }

  async function recheck() {
    if (busy) return;
    setBusy(true);
    try {
      await registrationApi.recheck();
      setRechecked(true);
    } catch {
      /* the schedule below reads the state again either way */
    }
    setBusy(false);
    restart();
  }

  /** Starts the polling schedule over (after a recheck, or "try again" after an error). */
  function restart() {
    setStopped(false);
    setRound((n) => n + 1);
  }

  if (phase === 'loading')
    return (
      <Shell icon={<Loader2 size={26} className="animate-spin" />} title={r.checking} text="" />
    );

  if (phase === 'none')
    return (
      <Shell icon={<SearchX size={26} />} title={r.none.title} text={r.none.text}>
        <Link href="/register" className={buttonClasses({ size: 'sm' })}>
          {r.register}
        </Link>
        <Link href="/login" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          {r.login}
        </Link>
      </Shell>
    );

  if (phase === 'error' || !current)
    return (
      <Shell icon={<CloudOff size={26} />} title={r.error.title} text={r.error.text}>
        <Button type="button" size="sm" onClick={restart}>
          {r.retryLoad}
        </Button>
      </Shell>
    );

  const state = current.state;
  const Icon = ICONS[state];
  const details = [
    ...(current.invoiceNumber
      ? [{ label: r.invoice, value: <span className="font-mono">{current.invoiceNumber}</span> }]
      : []),
    ...(current.amountMinor !== null
      ? [{ label: r.amount, value: `৳${formatNumber(locale, current.amountMinor / 100)}` }]
      : []),
  ];

  return (
    <Shell
      icon={<Icon size={26} className={state === 'confirming' ? 'animate-spin' : undefined} />}
      title={r[state].title}
      text={r[state].text}
    >
      {details.length > 0 ? (
        <div className="w-full text-left">
          <DetailList columns={2} items={details} />
        </div>
      ) : null}

      {state === 'awaiting_payment' && current.canResume ? (
        <Button type="button" size="sm" disabled={busy} onClick={() => act(registrationApi.resume)}>
          {r.continue}
        </Button>
      ) : null}

      {state === 'failed' || state === 'expired' ? (
        <>
          {current.canRetry ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => act(registrationApi.retry)}
            >
              {r.tryAgain}
            </Button>
          ) : (
            <p className="w-full text-sm text-ink-muted">{r.noRetry}</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(registrationApi.cancel, () => router.push('/register'))}
          >
            {r.startOver}
          </Button>
        </>
      ) : null}

      {state === 'completed' ? (
        // No session after paying (D2): the student logs in and lands on the free book (plan §16.4).
        <Link href={BOOK_LOGIN_HREF} className={buttonClasses({ size: 'sm' })}>
          {r.loginForBook}
        </Link>
      ) : null}

      {stopped && isMoving(state) ? (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-sm text-ink-muted">{r.stillWaiting}</p>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={recheck}>
            {r.recheck}
          </Button>
        </div>
      ) : null}

      {rechecked && isMoving(state) ? (
        <p role="status" className="w-full text-xs text-ink-muted">
          {r.rechecked}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="w-full text-sm font-medium text-danger-strong">
          {actionError}
        </p>
      ) : null}
    </Shell>
  );
}

function Shell({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary-soft text-secondary"
      >
        {icon}
      </span>
      <h2 className="text-2xl font-bold text-ink">{title}</h2>
      {text ? <p className="text-sm text-ink-muted">{text}</p> : null}
      {children ? (
        <div className="mt-2 flex w-full flex-wrap justify-center gap-3">{children}</div>
      ) : null}
    </div>
  );
}
