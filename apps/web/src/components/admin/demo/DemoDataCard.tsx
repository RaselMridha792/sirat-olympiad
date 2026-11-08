'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Trash2, Upload } from 'lucide-react';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_REASON_LIMITS,
  type AdminDemoStatus,
  type DemoLoadAccepted,
} from '@sirat/shared';
import { Badge, Button, Card, DetailList, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminDemoMessages } from '@/i18n/messages/admin-demo';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import {
  demoCountRows,
  demoProblem,
  demoRemovable,
  demoRunning,
  validDemoReason,
  type DemoProblem,
} from './demo-problem';

const PATH = '/admin/demo';
const POLL_MS = 2_000;
const COUNT_ORDER = [
  'students',
  'ambassadors',
  'jury',
  'exams',
  'questions',
  'attempts',
  'leaderboard_entries',
  'announcements',
  'registrations',
  'payments',
];

const answerOf = (err: unknown) =>
  err instanceof ApiRequestError ? { status: err.status, body: err.body } : null;

/**
 * Demo data on /admin/settings (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"): load with a
 * reason (the password is shown once, in the dialog), watch the job, remove with a reason. The API decides
 * everything (switch, one batch, payments' guard, the database's refusal of any mix); the card only shows it.
 */
export function DemoDataCard({
  locale,
  status,
}: {
  locale: Locale;
  status: AdminDemoStatus | null;
}) {
  const m = pick(adminDemoMessages, locale);
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  // A refreshed page brings a new status: it replaces what the polling showed (adjusted while rendering, not in an
  // effect: https://react.dev/learn/you-might-not-need-an-effect).
  const [fromPage, setFromPage] = useState(status);
  if (status !== fromPage) {
    setFromPage(status);
    setCurrent(status);
  }
  const running = current ? demoRunning(current) : false;

  // While a job runs, ask again every 2 s; once it ends, the server parts of the page refresh too.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const next = await api<AdminDemoStatus>(PATH);
        if (stop) return;
        setCurrent(next);
        if (!demoRunning(next)) router.refresh();
      } catch {
        // A failed poll leaves the last status on screen; the next tick tries again.
      }
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [running, router]);

  if (!current)
    return (
      <Card>
        <h2 className="text-lg font-bold text-ink">{m.title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{m.errors.busy}</p>
      </Card>
    );

  const batch = current.batch;
  const outcome = current.lastOutcome;
  const step = current.progress?.step;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <FlaskConical aria-hidden="true" className="h-5 w-5 shrink-0 text-secondary" />
            {m.title}
            {batch ? (
              <Badge
                tone={
                  batch.status === 'loaded'
                    ? 'warning'
                    : batch.status === 'failed'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {m.status[batch.status]}
              </Badge>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{m.intro}</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {!batch && current.allowed ? <LoadDialog locale={locale} /> : null}
          {demoRemovable(current) ? <ClearDialog locale={locale} onStarted={setCurrent} /> : null}
        </div>
      </div>

      <p className="text-sm font-medium text-warning-strong">{m.launchNote}</p>
      {!current.allowed ? <p className="text-sm text-ink-muted">{m.off}</p> : null}

      {running ? (
        <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
          {m.running(step ? (m.steps[step] ?? step) : m.steps.queued!)}
        </p>
      ) : null}

      {outcome && !running ? (
        <div role="status" className="text-sm">
          {outcome.result === 'blocked' ? (
            <div className="rounded-control bg-danger-soft p-3 text-danger-strong">
              <p className="font-medium">{m.outcome.blocked}</p>
              <ul className="mt-2 list-disc pl-5">
                {Object.entries(outcome.blockers ?? {}).map(([kind, n]) => (
                  <li key={kind}>
                    {m.blockers[kind] ?? kind}: {formatNumber(locale, n)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={outcome.result === 'done' ? 'text-ink-muted' : 'text-danger-strong'}>
              {outcome.action === 'load'
                ? outcome.result === 'done'
                  ? m.outcome.loadDone
                  : m.outcome.loadFailed
                : outcome.result === 'done'
                  ? m.outcome.clearDone
                  : m.outcome.clearFailed}
            </p>
          )}
        </div>
      ) : null}

      {batch ? (
        <>
          <p className="text-xs text-ink-muted">
            {m.loadedBy(batch.createdByName, formatDateTime(locale, batch.createdAt))}
          </p>
          {batch.status === 'failed' ? (
            <p className="text-sm text-danger-strong">{m.failedText}</p>
          ) : null}
          {batch.stale ? <p className="text-sm text-danger-strong">{m.staleText}</p> : null}
          {Object.keys(batch.counts).length > 0 ? (
            <DetailList
              columns={3}
              items={demoCountRows(batch.counts, COUNT_ORDER).map(({ key, value }) => ({
                label: m.counts[key] ?? key,
                value: formatNumber(locale, value),
              }))}
            />
          ) : null}
        </>
      ) : (
        <p className="text-sm text-ink-muted">{m.none}</p>
      )}
    </Card>
  );
}

function useReasonForm() {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<DemoProblem | 'reason' | null>(null);
  const [saving, setSaving] = useState(false);
  return { reason, setReason, problem, setProblem, saving, setSaving };
}

/**
 * The password stays on screen until the admin closes the dialog; only then does the page read the new status (the
 * card would otherwise swap the load button, and this dialog with it, for the running job).
 */
function LoadDialog({ locale }: { locale: Locale }) {
  const m = pick(adminDemoMessages, locale);
  const router = useRouter();
  const f = useReasonForm();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  function close() {
    if (f.saving) return;
    setOpen(false);
    f.setProblem(null);
    if (password) {
      setPassword(null); // gone from memory once the dialog closes: shown once
      router.refresh();
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (f.saving) return;
    if (!validDemoReason(f.reason)) return f.setProblem('reason');
    f.setSaving(true);
    f.setProblem(null);
    try {
      const out = await api<DemoLoadAccepted>(`${PATH}/load`, {
        method: 'POST',
        body: JSON.stringify({ reason: f.reason.trim() }),
      });
      setPassword(out.password);
      f.setReason('');
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      f.setProblem(demoProblem(answerOf(err)));
    }
    f.setSaving(false);
  }

  const l = m.load;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Upload aria-hidden="true" size={16} />
        {l.button}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={password ? l.passwordTitle : l.title}
        closeLabel={l.cancel}
      >
        {password ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">{l.passwordText}</p>
            <p className="select-all rounded-control bg-page p-3 text-center font-mono text-lg font-bold text-ink">
              {password}
            </p>
            <p className="text-sm text-ink-muted">{l.logins(DEMO_EMAIL_DOMAIN)}</p>
            <div className="flex justify-end">
              <Button type="button" onClick={close}>
                {l.close}
              </Button>
            </div>
          </div>
        ) : (
          <ReasonForm
            id="demo-load"
            text={l.text}
            labels={l}
            form={f}
            errors={m.errors}
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </Dialog>
    </>
  );
}

function ClearDialog({
  locale,
  onStarted,
}: {
  locale: Locale;
  onStarted: (s: AdminDemoStatus) => void;
}) {
  const m = pick(adminDemoMessages, locale);
  const f = useReasonForm();
  const [open, setOpen] = useState(false);

  function close() {
    if (f.saving) return;
    setOpen(false);
    f.setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (f.saving) return;
    if (!validDemoReason(f.reason)) return f.setProblem('reason');
    f.setSaving(true);
    f.setProblem(null);
    try {
      const next = await api<AdminDemoStatus>(`${PATH}/clear`, {
        method: 'POST',
        body: JSON.stringify({ reason: f.reason.trim() }),
      });
      f.setReason('');
      f.setSaving(false);
      setOpen(false);
      onStarted(next);
      return;
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      f.setProblem(demoProblem(answerOf(err)));
    }
    f.setSaving(false);
  }

  const c = m.clear;
  return (
    <>
      <Button type="button" size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" size={16} />
        {c.button}
      </Button>
      <Dialog open={open} onClose={close} title={c.title} closeLabel={c.cancel}>
        <ReasonForm
          id="demo-clear"
          text={c.text}
          labels={c}
          form={f}
          errors={m.errors}
          onSubmit={submit}
          onCancel={close}
          danger
        />
      </Dialog>
    </>
  );
}

function ReasonForm({
  id,
  text,
  labels,
  form,
  errors,
  onSubmit,
  onCancel,
  danger = false,
}: {
  id: string;
  text: string;
  labels: { reason: string; reasonHint: string; confirm: string; pending: string; cancel: string };
  form: ReturnType<typeof useReasonForm>;
  errors: Record<DemoProblem | 'reason', string>;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const problem = form.problem;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink-muted">{text}</p>
      <Field
        id={`${id}-reason`}
        name="reason"
        label={labels.reason}
        hint={labels.reasonHint}
        maxLength={DEMO_REASON_LIMITS.max}
        autoComplete="off"
        value={form.reason}
        onChange={(e) => form.setReason(e.target.value)}
        error={problem === 'reason' ? errors.reason : undefined}
      />
      {problem && problem !== 'reason' ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {errors[problem]}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={form.saving}>
          {labels.cancel}
        </Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={form.saving}>
          {form.saving ? labels.pending : labels.confirm}
        </Button>
      </div>
    </form>
  );
}
