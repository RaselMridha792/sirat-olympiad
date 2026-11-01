'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, SessionExpiredError } from '@/lib/api';
import { teamProblem, type TeamProblem } from './team-problem';

/** One team write from the browser (core C5b-3) through api(), then a server refresh; a refusal sets `problem`. */
export function useTeamAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<TeamProblem | null>(null);

  async function run<T>(
    path: string,
    method: 'POST' | 'PATCH',
    body?: unknown,
  ): Promise<T | true | null> {
    if (pending) return null;
    setPending(true);
    setProblem(null);
    try {
      const answer = await api<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      router.refresh();
      return answer ?? true;
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setProblem(teamProblem(error));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, problem, setProblem, run };
}
