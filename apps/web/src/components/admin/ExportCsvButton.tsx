'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { ADMIN_USER_EXPORT } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAuditMessages } from '@/i18n/messages/admin-audit';
import { adminUsersMessages } from '@/i18n/messages/admin-users';
import { api, SessionExpiredError } from '@/lib/api';
import { exportProblem, type ExportProblem } from './export-problem';

/** Each audited CSV export: its endpoint, its file name and its texts (picked here, so no message travels as a prop). */
const EXPORTS = {
  users: { path: '/admin/users/export', prefix: 'students', messages: adminUsersMessages },
  audit: { path: '/admin/audit/export', prefix: 'audit-log', messages: adminAuditMessages },
} as const;

/** `<prefix>-YYYYMMDD-HHmm.csv` in the admin's own clock (the server names its file the same way). */
const fileName = (prefix: string, now: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
};

/**
 * "Export CSV": asks for a reason, then POSTs the page's own filters plus the reason through api() (CSRF header,
 * session renewal) and saves the file. The file never passes through the web server and is never kept in the browser
 * beyond the download. The server writes the export's audit row before it sends anything.
 */
export function ExportCsvButton({
  locale,
  kind,
  body,
}: {
  locale: Locale;
  kind: keyof typeof EXPORTS;
  /** Sent as the JSON body, with `reason` added. */
  body: Record<string, unknown>;
}) {
  const config = EXPORTS[kind];
  const m = pick(config.messages, locale).exportCsv;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ExportProblem | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = reason.trim();
    if (text.length < ADMIN_USER_EXPORT.reasonMin || text.length > ADMIN_USER_EXPORT.reasonMax) {
      setProblem('reason');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const file = await api<Blob>(config.path, {
        method: 'POST',
        body: JSON.stringify({ ...body, reason: text }),
        as: 'blob',
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(config.prefix, new Date());
      link.click();
      URL.revokeObjectURL(url);
      setDone(true);
      setOpen(false);
      setReason('');
    } catch (error) {
      if (error instanceof SessionExpiredError) return; // api() is taking the browser to /login
      setProblem(exportProblem(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
      >
        <Download aria-hidden="true" size={16} />
        {m.button}
      </Button>
      {done ? (
        <p role="status" className="text-xs text-ink-muted">
          {m.done}
        </p>
      ) : null}
      <Dialog open={open} onClose={close} title={m.title} closeLabel={m.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.intro}</p>
          <Field
            id={`export-reason-${kind}`}
            name="reason"
            label={m.reason}
            hint={m.reasonHint}
            value={reason}
            maxLength={ADMIN_USER_EXPORT.reasonMax}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
            error={problem === 'reason' ? m.errors.reason : undefined}
          />
          {problem && problem !== 'reason' ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : m.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
