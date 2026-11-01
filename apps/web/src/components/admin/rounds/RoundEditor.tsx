'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { DEFAULT_VIDEO_CRITERIA, ROUND_LIMITS as L, type AdminRound } from '@sirat/shared';
import { Button, Dialog, Field, SelectField, TextAreaField } from '@sirat/ui';
import { dhakaToIso, isoToDhaka } from '@/components/exam/admin/exam-authoring';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminRoundsMessages } from '@/i18n/messages/admin-rounds';
import { criteriaToText, textToCriteria } from './round-form';
import { useRoundAction } from './use-round-action';

type Kind = 'video' | 'final';

/**
 * Add a round (no `round`) or edit one (core C6a): POST /api/admin/rounds or PATCH /api/admin/rounds/:id with the
 * version seen. Times are Bangladesh wall-clock times; an edit sends only the fields that changed.
 */
export function RoundEditor({ locale, round }: { locale: Locale; round?: AdminRound }) {
  const m = pick(adminRoundsMessages, locale);
  const { pending, problem, setProblem, run } = useRoundAction();
  const startText = (iso: string | null | undefined) => (iso ? isoToDhaka(iso) : '');
  const startCriteria = round?.criteria ?? (round ? [] : DEFAULT_VIDEO_CRITERIA);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(round?.name ?? '');
  const [type, setType] = useState<Kind>(round?.type === 'final' ? 'final' : 'video');
  const [opensAt, setOpensAt] = useState(startText(round?.opensAt));
  const [closesAt, setClosesAt] = useState(startText(round?.closesAt));
  const [criteria, setCriteria] = useState(criteriaToText(startCriteria));
  const kind = round ? round.type : type;
  const id = round?.id ?? 'new';

  function reset() {
    setProblem(null);
    setName(round?.name ?? '');
    setOpensAt(startText(round?.opensAt));
    setClosesAt(startText(round?.closesAt));
    setCriteria(criteriaToText(startCriteria));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    const trimmed = name.trim();
    if (trimmed.length < L.nameMin || trimmed.length > L.nameMax) return setProblem('invalid');
    if (!round || trimmed !== round.name) body.name = trimmed;
    if (kind !== 'quiz') {
      for (const [key, value, before] of [
        ['opensAt', opensAt, round?.opensAt],
        ['closesAt', closesAt, round?.closesAt],
      ] as const) {
        if (!value) continue;
        const iso = dhakaToIso(value);
        if (!iso) return setProblem('bad_window');
        if (!before || Date.parse(before) !== Date.parse(iso)) body[key] = iso;
      }
    }
    if (kind === 'video' && criteria !== criteriaToText(startCriteria)) {
      const list = textToCriteria(criteria);
      if (!list) return setProblem('bad_criteria');
      body.criteria = list;
    }
    if (round && Object.keys(body).length === 0) return setProblem('nothing_to_update');
    const done = round
      ? await run(`/admin/rounds/${encodeURIComponent(round.id)}`, 'PATCH', {
          ...body,
          expectedUpdatedAt: round.updatedAt,
        })
      : await run('/admin/rounds', 'POST', { ...body, name: trimmed, type });
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant={round ? 'outline' : 'primary'}
        size={round ? 'sm' : 'md'}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {round ? <Pencil aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
        {round ? m.edit : m.add}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={round ? m.editor.editTitle(round.name) : m.editor.createTitle}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            id={`round-name-${id}`}
            name="name"
            label={m.editor.name}
            value={name}
            maxLength={L.nameMax}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
          {round ? null : (
            <SelectField
              id="round-type"
              name="type"
              label={m.editor.type}
              value={type}
              options={[
                { value: 'video', label: m.editor.types.video },
                { value: 'final', label: m.editor.types.final },
              ]}
              onChange={(e) => setType(e.target.value === 'final' ? 'final' : 'video')}
            />
          )}
          {kind === 'quiz' ? (
            <p className="text-sm text-ink-muted">{m.editor.quizNote}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id={`round-opens-${id}`}
                name="opensAt"
                type="datetime-local"
                label={m.editor.opensAt}
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
              <Field
                id={`round-closes-${id}`}
                name="closesAt"
                type="datetime-local"
                label={m.editor.closesAt}
                hint={m.editor.windowHint}
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
            </div>
          )}
          {kind === 'video' ? (
            <TextAreaField
              id={`round-criteria-${id}`}
              name="criteria"
              label={m.editor.criteria}
              hint={m.editor.criteriaHint}
              rows={8}
              value={criteria}
              disabled={round?.scored}
              onChange={(e) => setCriteria(e.target.value)}
            />
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : round ? m.editor.submitEdit : m.editor.submitCreate}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
