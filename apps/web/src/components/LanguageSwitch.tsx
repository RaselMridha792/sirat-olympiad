import { cn } from '@sirat/ui';
import { setLocaleAction } from '@/i18n/actions';
import { common } from '@/i18n/common';
import { LOCALES } from '@/i18n/config';
import { getMessages } from '@/i18n/server';

/** বাংলা | English toggle for the top bar. A plain form post: works without JavaScript. */
export async function LanguageSwitch({ tone = 'surface' }: { tone?: 'shell' | 'surface' }) {
  const { locale, m } = await getMessages(common);
  const dark = tone === 'shell';
  return (
    <form action={setLocaleAction}>
      <div
        role="group"
        aria-label={m.language.label}
        className={cn(
          'flex items-center gap-1 rounded-control p-1',
          dark ? 'bg-white/10' : 'border border-line bg-page',
        )}
      >
        {LOCALES.map((value) => {
          const active = value === locale;
          return (
            <button
              key={value}
              type="submit"
              name="locale"
              value={value}
              lang={value}
              aria-pressed={active}
              className={cn(
                'rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors',
                // A language's own name in the system font: the web font would load the whole Bangla font here.
                value === 'bn' && locale !== 'bn' && 'font-system',
                active
                  ? 'bg-primary-strong text-white'
                  : dark
                    ? 'text-white/80 hover:bg-white/10 hover:text-white'
                    : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              {value === 'bn' ? m.language.bn : m.language.en}
            </button>
          );
        })}
      </div>
    </form>
  );
}
