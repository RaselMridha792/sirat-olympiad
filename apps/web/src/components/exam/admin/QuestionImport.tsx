'use client';
import { useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import {
  QUESTION_IMPORT_COLUMNS,
  type QuestionImportError,
  type QuestionImportPreview,
  type QuestionImportResult,
} from '@sirat/shared';
import { Button, Dialog } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick, type Messages } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { api } from '@/lib/api';
import {
  importErrorText,
  importFailure,
  importFileProblem,
  importRequest,
  isImportPreview,
  type ImportFailure,
  type ImportFileProblem,
} from './exam-authoring';

type M = Messages<typeof adminExamAuthoringMessages>;

/**
 * The CSV import dialog (E7a): choose a file, check it (a dry run that writes nothing), then import all rows or none.
 * The problems are listed by spreadsheet row and column; question texts are shown as plain text only.
 */
function ImportDialog({
  m,
  locale,
  examId,
  onClose,
}: {
  m: M;
  locale: Locale;
  examId: string;
  onClose: () => void;
}) {
  const t = m.import;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<ImportFileProblem | null>(null);
  /** The dry run of the chosen file; a new file clears it. */
  const [checked, setChecked] = useState<QuestionImportPreview | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const n = (value: number) => formatNumber(locale, value);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setFileProblem(chosen ? importFileProblem(chosen) : null);
    setChecked(null);
    setFailure(null);
  }

  async function send(dryRun: boolean) {
    if (!file || fileProblem || busy) return;
    setBusy(dryRun ? 'check' : 'import');
    setFailure(null);
    try {
      const [path, init] = importRequest(examId, file, dryRun);
      const answer = await api<unknown>(path, init);
      if (!dryRun) {
        setCreated((answer as QuestionImportResult).created);
        router.refresh();
      } else if (isImportPreview(answer)) setChecked(answer);
      else setFailure({ kind: 'refused', problems: ['failed'] });
    } catch (error) {
      setChecked(null);
      setFailure(importFailure(error));
    }
    setBusy(null);
  }

  const close = () => {
    if (!busy) onClose();
  };
  const rowProblems: QuestionImportError[] = checked?.errors.length
    ? checked.errors
    : failure?.kind === 'rows'
      ? failure.errors
      : [];
  const ready = Boolean(checked && checked.errors.length === 0 && checked.rows > 0);
  const generalProblem =
    fileProblem !== null
      ? t.fileProblems[fileProblem]
      : failure?.kind === 'tooBig'
        ? t.fileProblems.tooBig
        : null;

  return (
    <Dialog
      open
      onClose={close}
      title={t.title}
      closeLabel={t.cancel}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" disabled={busy !== null} onClick={close}>
            {created === null ? t.cancel : t.close}
          </Button>
          {created !== null ? null : ready && checked ? (
            <Button
              loading={busy === 'import'}
              loadingLabel={t.importing}
              onClick={() => void send(false)}
            >
              {t.importN(n(checked.rows))}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!file || fileProblem !== null}
              loading={busy === 'check'}
              loadingLabel={t.checking}
              onClick={() => void send(true)}
            >
              {t.check}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">{t.intro}</p>
        <code className="block overflow-x-auto whitespace-nowrap rounded-control bg-page p-3 text-xs text-ink">
          {QUESTION_IMPORT_COLUMNS.join(',')}
        </code>
        <p className="text-xs text-ink-muted">{t.columnsHint}</p>

        {created === null ? (
          <div className="space-y-1">
            <label htmlFor="question-import-file" className="text-sm font-semibold text-ink">
              {t.file}
            </label>
            <input
              id="question-import-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy !== null}
              onChange={choose}
              aria-describedby="question-import-hint"
              className="block text-sm"
            />
            <p id="question-import-hint" className="text-xs text-ink-faint">
              {t.fileHint}
            </p>
          </div>
        ) : null}

        {generalProblem ? (
          <p role="alert" className="text-sm font-semibold text-danger-strong">
            {generalProblem}
          </p>
        ) : null}

        {failure?.kind === 'refused' ? (
          <ul
            role="alert"
            className="list-disc space-y-1 ps-5 text-sm font-semibold text-danger-strong"
          >
            {failure.problems.map((code) => (
              <li key={code}>{m.errors[code]}</li>
            ))}
          </ul>
        ) : null}

        {rowProblems.length > 0 ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm font-semibold text-danger-strong">
              {checked?.truncated
                ? `${t.problems(`${n(rowProblems.length)}+`)} ${t.truncated(n(rowProblems.length))}`
                : t.problems(n(rowProblems.length))}
            </p>
            <ul className="max-h-64 list-disc space-y-1 overflow-y-auto rounded-control border border-line bg-page py-2 pe-3 ps-8 text-sm text-ink">
              {rowProblems.map((e) => (
                <li key={`${e.row}-${e.field}-${e.code}`}>{importErrorText(e, t, n)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {ready && checked && created === null ? (
          <p
            role="status"
            className="rounded-control bg-success-soft p-3 text-sm text-success-strong"
          >
            {t.ready(n(checked.rows))}
          </p>
        ) : null}

        {created !== null ? (
          <p
            role="status"
            className="rounded-control bg-success-soft p-3 text-sm text-success-strong"
          >
            {t.done(n(created))}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** "Import CSV" beside "Add question", for a draft only (the server refuses the rest too). */
export function ImportQuestionsButton({ locale, examId }: { locale: Locale; examId: string }) {
  const m = pick(adminExamAuthoringMessages, locale);
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" disabled={!hydrated} onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-2">
          <Upload size={16} aria-hidden="true" />
          {m.import.button}
        </span>
      </Button>
      {open ? (
        <ImportDialog m={m} locale={locale} examId={examId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
