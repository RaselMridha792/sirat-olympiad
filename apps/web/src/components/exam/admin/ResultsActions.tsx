'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonClasses, Dialog } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import { refusalCode } from '@/components/exam/exam-api';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminExamResultsMessages } from '@/i18n/messages/admin-exam-results';
import { api } from '@/lib/api';

type Action = 'build' | 'publish' | 'unpublish';

/**
 * Build, publish and unpublish an exam's results (EXAM-PLAN 3.12): browser writes through lib/api.ts (the cookie,
 * the CSRF header, one session renewal), then the page reads everything again. Publish and unpublish send the
 * exam's `updatedAt`, so a change made elsewhere since the page loaded is refused as `stale`, never overwritten.
 * The server decides what is allowed; the buttons only follow `canBuild` and `canPublish`.
 */
export function ResultsActions({
  locale,
  examId,
  updatedAt,
  canBuild,
  canPublish,
  published,
}: {
  locale: Locale;
  examId: string;
  updatedAt: string;
  canBuild: boolean;
  canPublish: boolean;
  published: boolean;
}) {
  const m = pick(adminExamResultsMessages, locale).results;
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: Action) {
    setConfirm(null);
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/exams/${encodeURIComponent(examId)}/results/${action}`, {
        method: 'POST',
        ...(action === 'build' ? {} : { body: JSON.stringify({ expectedUpdatedAt: updatedAt }) }),
      });
      if (action === 'build') setNotice(m.buildQueued);
      router.refresh();
    } catch (failure) {
      const code = refusalCode(failure);
      setError(
        code && code in m.errors ? m.errors[code as keyof typeof m.errors] : m.errors.generic,
      );
    } finally {
      setBusy(null);
    }
  }

  const idle = hydrated && busy === null;
  const dialog = confirm === 'unpublish' ? m.confirmUnpublish : m.confirmPublish;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {published ? (
          <Button
            variant="outline"
            disabled={!idle}
            loading={busy === 'unpublish'}
            loadingLabel={m.busy}
            onClick={() => setConfirm('unpublish')}
          >
            {m.unpublish}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={!idle || !canBuild}
              loading={busy === 'build'}
              loadingLabel={m.busy}
              onClick={() => void run('build')}
            >
              {m.build}
            </Button>
            <Button
              disabled={!idle || !canPublish}
              loading={busy === 'publish'}
              loadingLabel={m.busy}
              onClick={() => setConfirm('publish')}
            >
              {m.publish}
            </Button>
          </>
        )}
        <Link
          href={`/admin/leaderboard?exam=${encodeURIComponent(examId)}`}
          className={buttonClasses({ variant: 'ghost' })}
        >
          {m.openLeaderboard}
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger-strong">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={dialog.title}
        closeLabel={m.cancel}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {m.cancel}
            </Button>
            <Button
              variant={confirm === 'unpublish' ? 'danger' : 'primary'}
              onClick={() => confirm && void run(confirm)}
            >
              {dialog.confirm}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink">{dialog.body}</p>
      </Dialog>
    </div>
  );
}
