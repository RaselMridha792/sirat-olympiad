import type { AnswerList } from '@sirat/shared';
import { answerKeys, type LayoutV1, type QuestionVersion } from './layout';

/** A question version with its correct key, as the worker reads it from Postgres (never from the cache). */
export type KeyedVersion = Pick<QuestionVersion, 'options'> & { correctKey: string };

/**
 * One mark per correct answer, no negative marking (owner Q1). Answers are mapped through the attempt's own layout,
 * so each one is compared with the version the student saw.
 */
export function scoreAnswers(
  layout: LayoutV1,
  versions: ReadonlyMap<string, KeyedVersion>,
  answers: AnswerList,
): number {
  const chosen = answerKeys(layout, versions, answers);
  return layout.q.reduce(
    (score, id, i) =>
      chosen[i] !== null && chosen[i] === versions.get(id)?.correctKey ? score + 1 : score,
    0,
  );
}

/** The display position of the correct option in this attempt (for the review). */
export function correctPosition(layout: LayoutV1, index: number, version: KeyedVersion): number {
  const original = version.options.findIndex((o) => o.key === version.correctKey);
  return layout.o[index]!.indexOf(original);
}

/** Reads `{ v: 1, a: [...] }`; anything else counts as no answers. */
export function storedAnswers(json: unknown, questionCount: number): AnswerList {
  const a = (json as { v?: number; a?: unknown } | null)?.a;
  if (!Array.isArray(a) || a.length !== questionCount)
    return Array.from({ length: questionCount }, () => null);
  return a.map((x) => (Number.isInteger(x) ? (x as number) : null));
}
