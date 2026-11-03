import { CheckCircle2 } from 'lucide-react';
import { cn } from '@sirat/ui';

/*
 * One question and the question-number list, as students see them in the exam room. Shared by the player
 * (ExamRoom.tsx) and the admin preview, so the preview shows exactly the student's look. Presentational only: no
 * state, no API.
 */

/** One question: its text and its options as radio buttons, lettered by position. */
export function QuestionCard({
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

/** The numbered list of questions: the current one ringed, answered ones filled. */
export function QuestionNumbers({
  count,
  index,
  answered,
  onPick,
  format,
}: {
  count: number;
  index: number;
  answered: (i: number) => boolean;
  onPick: (i: number) => void;
  /** Formats a question number in the page's locale. */
  format: (n: number) => string;
}) {
  return (
    <ol className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onPick(i)}
            aria-current={i === index ? 'step' : undefined}
            className={cn(
              'h-9 w-9 rounded-control border text-sm font-bold transition-colors',
              answered(i)
                ? 'border-primary/30 bg-primary-soft text-primary-strong'
                : 'border-line bg-surface text-ink-muted hover:border-primary/40',
              i === index && 'ring-2 ring-primary ring-offset-1',
            )}
          >
            {format(i + 1)}
          </button>
        </li>
      ))}
    </ol>
  );
}
