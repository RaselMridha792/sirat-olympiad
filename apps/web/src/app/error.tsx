'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  // Never show raw error text to users (rulebook: no raw error dumps).
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-ink-muted">Please try again. If it keeps happening, contact support.</p>
      <button
        onClick={reset}
        className="rounded-control bg-primary px-5 py-2.5 font-semibold text-white"
      >
        Try again
      </button>
    </main>
  );
}
