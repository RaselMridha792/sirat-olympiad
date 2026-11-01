'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { AMBASSADOR_POINTS_LIMITS as L, type AmbassadorPointsConfig } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAmbassadorsMessages } from '@/i18n/messages/admin-ambassadors';
import { api, SessionExpiredError } from '@/lib/api';
import { pointsProblem, thresholdsValid, type PointsProblem } from './points-problem';

type Row = { name: string; minPoints: string };

/**
 * "Edit points and ranks" (core C5b): PUT /api/admin/ambassador-points with the values the admin saw (`expected`), so
 * two admins never overwrite each other (409). `config` is plain data from the server page.
 */
export function AmbassadorPointsEditor({
  locale,
  config,
}: {
  locale: Locale;
  config: AmbassadorPointsConfig;
}) {
  const m = pick(adminAmbassadorsMessages, locale).points;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perReferral, setPerReferral] = useState(String(config.pointsPerReferral));
  const [rows, setRows] = useState<Row[]>(() =>
    config.thresholds.map((t) => ({ name: t.name, minPoints: String(t.minPoints) })),
  );
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<PointsProblem | null>(null);

  function start() {
    setPerReferral(String(config.pointsPerReferral));
    setRows(config.thresholds.map((t) => ({ name: t.name, minPoints: String(t.minPoints) })));
    setReason('');
    setProblem(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const points = Number(perReferral.trim());
    const thresholds = rows.map((r) => ({
      name: r.name.trim(),
      minPoints: Number(r.minPoints.trim()),
    }));
    const text = reason.trim();
    if (!thresholdsValid(thresholds)) {
      setProblem('badThresholds');
      return;
    }
    if (
      !Number.isInteger(points) ||
      points < 0 ||
      points > L.maxPerReferral ||
      text.length < L.reasonMin ||
      text.length > L.reasonMax
    ) {
      setProblem('invalid');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await api<AmbassadorPointsConfig>('/admin/ambassador-points', {
        method: 'PUT',
        body: JSON.stringify({
          pointsPerReferral: points,
          thresholds,
          expected: config,
          reason: text,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(pointsProblem(error));
    } finally {
      setPending(false);
    }
  }

  const message =
    problem === 'badThresholds'
      ? m.errors.badThresholds
      : problem === 'stale'
        ? m.errors.stale
        : problem === 'invalid'
          ? m.errors.invalid
          : problem
            ? m.errors.failed
            : null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={start}>
        <Pencil aria-hidden="true" size={16} />
        {m.edit}
      </Button>
      <Dialog open={open} onClose={close} title={m.editTitle} closeLabel={m.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.editText}</p>
          <Field
            id="points-per-referral"
            name="pointsPerReferral"
            label={m.perReferralLabel}
            inputMode="numeric"
            value={perReferral}
            autoComplete="off"
            onChange={(e) => setPerReferral(e.target.value)}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold text-ink">{m.ranks}</legend>
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <Field
                  id={`rank-name-${i}`}
                  name={`rank-name-${i}`}
                  label={m.rankName}
                  value={row.name}
                  maxLength={L.nameMax}
                  autoComplete="off"
                  onChange={(e) => setRow(i, { name: e.target.value })}
                />
                <Field
                  id={`rank-min-${i}`}
                  name={`rank-min-${i}`}
                  label={m.rankMin}
                  inputMode="numeric"
                  value={row.minPoints}
                  autoComplete="off"
                  onChange={(e) => setRow(i, { minPoints: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={rows.length === 1}
                  aria-label={m.removeRank(row.name || String(i + 1))}
                  onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rows.length >= L.maxThresholds}
                onClick={() => setRows((list) => [...list, { name: '', minPoints: '' }])}
              >
                <Plus aria-hidden="true" size={16} />
                {m.addRank}
              </Button>
            </div>
          </fieldset>
          <Field
            id="points-reason"
            name="reason"
            label={m.reason}
            value={reason}
            maxLength={L.reasonMax}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
          />
          {message ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : m.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
