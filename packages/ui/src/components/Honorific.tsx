import { Fragment, type ReactNode } from 'react';
import { cn } from '../cn';
import { honorificSegments, isArabicScript } from '../honorific';

/**
 * The honorific after the Prophet's name. The text comes from i18n (one key), never from here. Arabic script (ﷺ)
 * gets lang="ar" and the Arabic font stack (--font-arabic), isolated from the Bangla around it so the bidi order
 * stays right; a plain form such as "(সা.)" renders as ordinary text. Text only, never an image.
 */
export function Honorific({ text, className }: { text: string; className?: string }) {
  if (!isArabicScript(text)) return <span className={className}>{text}</span>;
  return (
    <bdi lang="ar" className={cn('font-arabic text-[1.3em] leading-none', className)}>
      {text}
    </bdi>
  );
}

/**
 * A message with `{saw}` tokens, each replaced by <Honorific>. The rest stays plain text. The word before the
 * honorific and what is glued after it ("-এর") share one unbreakable span, so ﷺ never starts a line alone.
 */
export function WithHonorific({ text, honorific }: { text: string; honorific: string }): ReactNode {
  return honorificSegments(text).map((segment, index) =>
    segment.kind === 'text' ? (
      <Fragment key={index}>{segment.text}</Fragment>
    ) : (
      <span key={index} className="whitespace-nowrap">
        {segment.before}
        <Honorific text={honorific} />
        {segment.after}
      </span>
    ),
  );
}
