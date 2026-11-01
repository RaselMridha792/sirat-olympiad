'use client';
import { useState } from 'react';
import { Gavel, X } from 'lucide-react';
import {
  CATEGORIES,
  JURY_REFUSALS,
  type AdminRoundJury,
  type Category,
  type JuryAssignResult,
} from '@sirat/shared';
import { Button, Dialog, SelectField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { common } from '@/i18n/common';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminRoundsMessages } from '@/i18n/messages/admin-rounds';
import { useCall } from './use-call';

/**
 * A video round's judges (core C6b): who scores which category; add a jury account for chosen categories or remove
 * one (POST and DELETE /api/admin/rounds/:id/jury, audited). The judge's scores stay when an assignment goes.
 */
export function JuryButton({ locale, jury }: { locale: Locale; jury: AdminRoundJury }) {
  const m = pick(adminRoundsMessages, locale);
  const c = pick(common, locale);
  const n = (value: number) => formatNumber(locale, value);
  const { pending, problem, setProblem, run } = useCall(JURY_REFUSALS);
  const [open, setOpen] = useState(false);
  const [judgeId, setJudgeId] = useState(jury.candidates[0]?.userId ?? '');
  const [categories, setCategories] = useState<Category[]>([...CATEGORIES]);
  const [done, setDone] = useState<string | null>(null);
  const base = `/admin/rounds/${encodeURIComponent(jury.round.id)}/jury`;
  const error = problem ? (m.errors[problem as keyof typeof m.errors] ?? m.errors.failed) : null;

  async function add() {
    setDone(null);
    if (!judgeId || categories.length === 0) return setProblem('invalid');
    const answer = await run<JuryAssignResult>(base, 'POST', { judgeId, categories });
    if (answer && answer !== true)
      setDone(m.jury.assigned(n(answer.assigned), n(answer.alreadyAssigned)));
  }

  async function remove(id: string) {
    setDone(null);
    await run(`${base}/${encodeURIComponent(id)}`, 'DELETE');
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setProblem(null);
          setDone(null);
          setOpen(true);
        }}
      >
        <Gavel aria-hidden="true" size={16} />
        {m.jury.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.jury.title(jury.round.name)}
        closeLabel={m.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{m.jury.text}</p>
          {jury.assignments.length === 0 ? (
            <p className="text-sm text-ink-muted">{m.jury.none}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {jury.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-ink">
                  <span>
                    {a.judge.name} <span className="text-ink-muted">· {a.judge.email}</span> ·{' '}
                    {c.categories[a.category]}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    disabled={pending}
                    aria-label={m.jury.remove(a.judge.name, c.categories[a.category])}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-danger-soft hover:text-danger-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                  >
                    <X aria-hidden="true" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {jury.candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{m.jury.noCandidates}</p>
          ) : (
            <div className="flex flex-col gap-3 rounded-control border border-line bg-page p-4">
              <SelectField
                id={`jury-judge-${jury.round.id}`}
                name="judge"
                label={m.jury.judge}
                value={judgeId}
                options={jury.candidates.map((p) => ({
                  value: p.userId,
                  label: `${p.name} · ${p.email}`,
                }))}
                onChange={(e) => setJudgeId(e.target.value)}
              />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold text-ink">{m.jury.categories}</legend>
                <div className="flex flex-wrap gap-4">
                  {CATEGORIES.map((category) => (
                    <label
                      key={category}
                      className="inline-flex items-center gap-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={categories.includes(category)}
                        onChange={(e) =>
                          setCategories((list) =>
                            e.target.checked
                              ? [...list, category]
                              : list.filter((x) => x !== category),
                          )
                        }
                      />
                      {c.categories[category]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end">
                <Button type="button" onClick={add} disabled={pending}>
                  {pending ? m.pending : m.jury.assign}
                </Button>
              </div>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {error}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="text-sm font-semibold text-success-strong">
              {done}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
