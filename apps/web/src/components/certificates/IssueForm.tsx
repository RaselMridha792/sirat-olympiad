'use client';
import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import {
  CERTIFICATE_LIMITS as L,
  CERTIFICATE_REFUSALS,
  CERTIFICATE_TYPES,
  type CertificateIssueResult,
  type CertificateType,
} from '@sirat/shared';
import { Button, Field, SelectField, TextAreaField } from '@sirat/ui';
import { useCall } from '@/components/admin/rounds/use-call';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { certificatesMessages } from '@/i18n/messages/certificates';

/**
 * Ask for an issue run (core C6c-1): POST /api/admin/certificates/issue queues one job; the answer says how many
 * qualify now. Winners are named by email (final round only) with a reason.
 */
export function IssueForm({
  locale,
  rounds,
}: {
  locale: Locale;
  rounds: Array<{ id: string; name: string }>;
}) {
  const m = pick(certificatesMessages, locale);
  const n = (value: number) => formatNumber(locale, value);
  const { pending, problem, setProblem, run } = useCall(CERTIFICATE_REFUSALS);
  const [type, setType] = useState<CertificateType>('participation');
  const [roundId, setRoundId] = useState(rounds[0]?.id ?? '');
  const [emails, setEmails] = useState('');
  const [reason, setReason] = useState('');
  const [queued, setQueued] = useState<number | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setQueued(null);
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!roundId) return setProblem('invalid');
    if (
      type === 'winner' &&
      (list.length === 0 || list.length > L.winnersMax || reason.trim().length < L.reasonMin)
    )
      return setProblem('no_winners');
    const body =
      type === 'winner'
        ? { type, roundId, emails: list, reason: reason.trim() }
        : { type, roundId };
    const answer = await run<CertificateIssueResult>(
      '/admin/certificates/issue',
      'POST',
      body,
      false,
    );
    if (answer && answer !== true) setQueued(answer.candidates);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h2 className="text-lg font-bold text-ink">{m.admin.issue.title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="issue-type"
          name="type"
          label={m.admin.issue.type}
          value={type}
          options={CERTIFICATE_TYPES.map((t) => ({ value: t, label: m.types[t] }))}
          onChange={(e) => setType(e.target.value as CertificateType)}
        />
        <SelectField
          id="issue-round"
          name="round"
          label={m.admin.issue.round}
          value={roundId}
          options={rounds.map((r) => ({ value: r.id, label: r.name }))}
          onChange={(e) => setRoundId(e.target.value)}
        />
      </div>
      {type === 'winner' ? (
        <>
          <TextAreaField
            id="issue-emails"
            name="emails"
            label={m.admin.issue.emails}
            rows={4}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <Field
            id="issue-reason"
            name="reason"
            label={m.admin.issue.reason}
            maxLength={L.reasonMax}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {m.errors[problem as keyof typeof m.errors] ?? m.errors.failed}
        </p>
      ) : null}
      {queued !== null ? (
        <p role="status" className="text-sm font-semibold text-success-strong">
          {m.admin.issue.queued(n(queued))}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          <BadgeCheck aria-hidden="true" size={16} />
          {pending ? m.pending : m.admin.issue.submit}
        </Button>
      </div>
    </form>
  );
}
