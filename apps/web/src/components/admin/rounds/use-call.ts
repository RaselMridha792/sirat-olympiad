'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, SessionExpiredError } from '@/lib/api';
import { refusalOf, type Refusal } from './refusal';

/**
 * One browser write through api() (core C6b): a refusal sets `problem` (one of `known`, or by status); a success
 * refreshes the server page unless `refresh` is false.
 */
export function useCall<C extends string>(known: readonly C[]) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Refusal<C> | null>(null);

  async function run<T>(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
    refresh = true,
  ): Promise<T | true | null> {
    if (pending) return null;
    setPending(true);
    setProblem(null);
    try {
      const answer = await api<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (refresh) router.refresh();
      return answer ?? true;
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setProblem(refusalOf(error, known));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, problem, setProblem, run };
}
