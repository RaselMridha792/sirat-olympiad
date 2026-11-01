'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, SessionExpiredError } from '@/lib/api';
import { roundProblem, type RoundProblem } from './round-problem';

/**
 * One round call from the browser (core C6a) through api(); a refusal sets `problem`. Writes refresh the server
 * page; a preview (nothing written) does not.
 */
export function useRoundAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<RoundProblem | null>(null);

  async function run<T>(
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    refresh = true,
  ): Promise<T | null> {
    if (pending) return null;
    setPending(true);
    setProblem(null);
    try {
      const answer = await api<T>(path, { method, body: JSON.stringify(body) });
      if (refresh) router.refresh();
      return answer;
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setProblem(roundProblem(error));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, problem, setProblem, run };
}
