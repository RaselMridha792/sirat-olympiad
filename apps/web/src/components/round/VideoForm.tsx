'use client';
import { useState } from 'react';
import { Video } from 'lucide-react';
import { isAllowedVideoUrl, JURY_LIMITS, JURY_REFUSALS, type MyRound } from '@sirat/shared';
import { Button, Field } from '@sirat/ui';
import { useCall } from '@/components/admin/rounds/use-call';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { studentRoundMessages } from '@/i18n/messages/student-round';

/**
 * The student's video link for a video round (core C6b): PUT /api/rounds/:id/video through api(). The same allow-list
 * as the server is checked first; the link already sent is shown as text, never as a link.
 */
export function VideoForm({
  locale,
  roundId,
  sent,
}: {
  locale: Locale;
  roundId: string;
  sent: boolean;
}) {
  const m = pick(studentRoundMessages, locale);
  const { pending, problem, setProblem, run } = useCall(JURY_REFUSALS);
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const value = url.trim();
    if (!isAllowedVideoUrl(value)) return setProblem('bad_video_url');
    const answer = await run<MyRound>(`/rounds/${encodeURIComponent(roundId)}/video`, 'PUT', {
      url: value,
    });
    if (answer) {
      setSaved(true);
      setUrl('');
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field
        id="video-url"
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        label={m.video.label}
        placeholder={m.video.placeholder}
        hint={m.video.hint}
        maxLength={JURY_LIMITS.videoUrlMax}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setSaved(false);
        }}
      />
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {m.errors[problem as keyof typeof m.errors] ?? m.errors.failed}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm font-semibold text-success-strong">
          {m.video.saved}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          <Video aria-hidden="true" size={16} />
          {pending ? m.pending : sent ? m.video.change : m.video.submit}
        </Button>
      </div>
    </form>
  );
}
