import { Fragment, type ReactNode } from 'react';
import { cn } from '../cn';
import { isArabicScript, splitOnHonorific } from '../honorific';

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

/** A message with `{saw}` tokens, each replaced by <Honorific>. The rest stays plain text. */
export function WithHonorific({ text, honorific }: { text: string; honorific: string }): ReactNode {
  const parts = splitOnHonorific(text);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <Honorific text={honorific} /> : null}
      {part}
    </Fragment>
  ));
}
