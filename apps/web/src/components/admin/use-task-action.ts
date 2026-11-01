'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, SessionExpiredError } from '@/lib/api';
import { taskProblem, type TaskProblem } from './task-problem';

/**
 * One task write from the browser (core C5b-2): through api() (CSRF header, session renewal), then a server refresh
 * so the page shows the new state. `run` answers whether it worked; a refusal sets `problem` for the message.
 */
export function useTaskAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<TaskProblem | null>(null);

  async function run<T>(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T | null> {
    if (pending) return null;
    setPending(true);
    setProblem(null);
    try {
      const answer = await api<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      router.refresh();
      return answer;
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setProblem(taskProblem(error));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, problem, setProblem, run };
}
