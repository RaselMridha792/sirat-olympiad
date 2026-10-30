import type { Metadata } from 'next';
import { Card, PageHeader, Button, Countdown } from '@sirat/ui';

export const metadata: Metadata = { title: 'My Exams' };

// Exam-taking flow (see docs/03-HOW-IT-WORKS.md): waiting room -> start (server creates attempt)
// -> questions -> checkpoint every 60-120s -> idempotent final submit. This page is the waiting-room shell.
export default function ExamPage() {
  return (
    <>
      <PageHeader title="My Exams" />
      <Card className="max-w-xl">
        <h2 className="font-bold">Waiting room</h2>
        <p className="mt-1 text-sm text-ink-muted">The Start button activates when the window opens (server time).</p>
        <p className="mt-4 text-sm">Demo remaining time: <Countdown remainingSeconds={1800} /></p>
        <Button className="mt-4" disabled>Start exam</Button>
      </Card>
    </>
  );
}
