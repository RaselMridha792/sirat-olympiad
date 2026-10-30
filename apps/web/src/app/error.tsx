'use client';
import { Button } from '@sirat/ui';
import { common } from '@/i18n/common';

const { bn, en } = common;

/**
 * Root error boundary. A segment's error.tsx does not wrap its own layout, so this one catches
 * errors thrown by the two dashboard layouts (getSession, getMessages) and by the public pages.
 * It sits outside every I18nProvider and cannot know the visitor's language, so it shows both,
 * Bangla first, in the same card as ErrorState (whose string props cannot carry `lang`). Never
 * shows the raw error. `retry` re-fetches the server data; `reset` would only re-render the same
 * failed result.
 */
export default function RootError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div
        role="alert"
        className="w-full max-w-lg rounded-card border border-danger/30 bg-danger-soft px-6 py-8 text-center"
      >
        <h1 className="text-lg font-bold text-danger-strong">
          <span lang="bn" className="block">
            {bn.states.errorTitle}
          </span>{' '}
          <span lang="en" className="block">
            {en.states.errorTitle}
          </span>
        </h1>
        <p lang="bn" className="mt-3 font-semibold text-danger-strong">
          {bn.states.errorMessage}
        </p>
        <p lang="en" className="mt-1 font-semibold text-danger-strong">
          {en.states.errorMessage}
        </p>
        <Button type="button" variant="danger" className="mt-5" onClick={() => retry()}>
          <span lang="bn">{bn.states.retry}</span> <span aria-hidden="true">/</span>{' '}
          <span lang="en">{en.states.retry}</span>
        </Button>
      </div>
    </main>
  );
}
