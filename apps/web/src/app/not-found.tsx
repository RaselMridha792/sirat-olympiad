import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-5xl font-extrabold text-secondary">404</h1>
      <p className="text-ink-muted">This page does not exist.</p>
      <Link href="/" className="font-semibold text-primary underline">Back to home</Link>
    </main>
  );
}
