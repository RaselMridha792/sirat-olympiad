import { randomInt } from 'node:crypto';
import type { AnswerList } from '@sirat/shared';

/*
 * An attempt's layout (EXAM-PLAN 2.2, 3.3): which question versions, in which order, and each one's option order.
 * Decided on the server with a CSPRNG and stored on the attempt; the client only ever sees texts in that order and
 * answers by position, never a question id, an option key or the correct key.
 */

/** v1: { v: 1, q: [questionId...], o: [[2, 0, 3, 1], ...] } (display order as indexes into each question's options). */
export interface LayoutV1 {
  v: 1;
  q: string[];
  o: number[][];
}

/** One question version as the cache holds it: never the correct key or the explanation. */
export interface QuestionVersion {
  text: string;
  options: Array<{ key: string; text: string }>;
  keepOptionOrder: boolean;
}

/** Integer in [0, maxExclusive). Production uses crypto.randomInt; tests can pass a seeded one. */
export type Rng = (maxExclusive: number) => number;

/** Fisher–Yates on a copy. */
export function shuffled<T>(items: readonly T[], rng: Rng = randomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Same questions for everyone by default (owner Q2): all of the pool, in a random order. With `randomDraw`, N of a
 * larger pool. Options shuffled per question unless it keeps its order.
 */
export function drawLayout(
  poolIds: readonly string[],
  questionCount: number,
  randomDraw: boolean,
  versions: ReadonlyMap<string, QuestionVersion>,
  rng: Rng = randomInt,
): LayoutV1 {
  if (poolIds.length < questionCount || (!randomDraw && poolIds.length !== questionCount))
    throw new Error(`pool of ${poolIds.length} does not fit ${questionCount} questions`);
  const q = shuffled(poolIds, rng).slice(0, questionCount);
  const o = q.map((id) => {
    const version = versions.get(id);
    if (!version) throw new Error(`question version ${id} missing from the pool`);
    const order = version.options.map((_, i) => i);
    return version.keepOptionOrder ? order : shuffled(order, rng);
  });
  return { v: 1, q, o };
}

/** Reads a stored layout; throws on anything that is not a well-formed v1 layout. */
export function parseLayout(json: unknown): LayoutV1 {
  const l = json as Partial<LayoutV1> | null;
  if (
    !l ||
    l.v !== 1 ||
    !Array.isArray(l.q) ||
    !Array.isArray(l.o) ||
    l.q.length !== l.o.length ||
    !l.q.every((id) => typeof id === 'string') ||
    !l.o.every((p) => Array.isArray(p) && p.every((i) => Number.isInteger(i)))
  )
    throw new Error('malformed attempt layout');
  return l as LayoutV1;
}

/** What the student sees: texts only, in this attempt's order. */
export function renderQuestions(
  layout: LayoutV1,
  versions: ReadonlyMap<string, QuestionVersion>,
): Array<{ text: string; options: string[] }> {
  return layout.q.map((id, i) => {
    const version = versions.get(id);
    if (!version) throw new Error(`question version ${id} missing`);
    return { text: version.text, options: layout.o[i]!.map((k) => version.options[k]!.text) };
  });
}

/** Option counts per position, for checking answers without reading the questions. */
export const optionCounts = (layout: LayoutV1): number[] => layout.o.map((p) => p.length);

/** Exactly one entry per question, each null or a displayed option position. */
export function answersValid(answers: unknown, counts: readonly number[]): answers is AnswerList {
  return (
    Array.isArray(answers) &&
    answers.length === counts.length &&
    answers.every(
      (a, i) =>
        a === null || (Number.isInteger(a) && (a as number) >= 0 && (a as number) < counts[i]!),
    )
  );
}

/** Maps displayed positions back to option keys (scoring and review use this; E3). */
export function answerKeys(
  layout: LayoutV1,
  versions: ReadonlyMap<string, Pick<QuestionVersion, 'options'>>,
  answers: AnswerList,
): Array<string | null> {
  return layout.q.map((id, i) => {
    const pick = answers[i];
    if (pick === null || pick === undefined) return null;
    const original = layout.o[i]![pick];
    const version = versions.get(id);
    return original === undefined || !version ? null : (version.options[original]?.key ?? null);
  });
}
