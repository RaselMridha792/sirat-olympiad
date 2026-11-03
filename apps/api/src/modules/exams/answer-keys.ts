import type { Prisma, PrismaClient } from '@prisma/client';

/*
 * The key in effect for a question (E7b): the newest answer-key correction's, else the question's own. The question
 * rows are never changed once published (questions_frozen_after_publish); a correction is an append-only row. Every
 * reader of a key (scoring, the re-scoring, the student review, the admin views) goes through these two functions.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The newest correction's key for each of these questions that has one (question id → key). */
export async function correctedKeys(db: Db, questionIds: string[]): Promise<Map<string, string>> {
  if (questionIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ question_id: string; to_key: string }[]>`
    SELECT DISTINCT ON ("question_id") "question_id", "to_key"
    FROM "answer_key_corrections"
    WHERE "question_id" = ANY(${questionIds}::uuid[])
    ORDER BY "question_id", "created_at" DESC, "id" DESC`;
  return new Map(rows.map((r) => [r.question_id, r.to_key]));
}

/**
 * The database's clock now, read after the caller's lock (clock_timestamp(), not now(), which is the transaction's
 * start). A correction's created_at and every scored_at come from here, so "scored before the correction" compares
 * one clock, never the API's or the worker's against Postgres's.
 */
export async function databaseNow(db: Db): Promise<Date> {
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
  return row!.now;
}

/** The key in effect for one question version. */
export const effectiveKey = (
  corrected: ReadonlyMap<string, string>,
  question: { id: string; correctKey: string },
): string => corrected.get(question.id) ?? question.correctKey;
