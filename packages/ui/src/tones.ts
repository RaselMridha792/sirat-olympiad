/**
 * Text-on-background pairs for badges and labels: ONE source for the Tailwind classes and the
 * token pair behind them, so apps/web/src/design/contrast.test.ts can prove every pair reaches
 * WCAG AA (4.5:1). Classes are literal strings so Tailwind's scanner generates them.
 * gold/silver/bronze are rank badges (light background, dark text).
 */
export const TONES = {
  neutral: { bg: 'page', fg: 'ink-muted', className: 'bg-page text-ink-muted' },
  success: {
    bg: 'success-soft',
    fg: 'success-strong',
    className: 'bg-success-soft text-success-strong',
  },
  warning: {
    bg: 'warning-soft',
    fg: 'warning-strong',
    className: 'bg-warning-soft text-warning-strong',
  },
  danger: {
    bg: 'danger-soft',
    fg: 'danger-strong',
    className: 'bg-danger-soft text-danger-strong',
  },
  info: { bg: 'info-soft', fg: 'info-strong', className: 'bg-info-soft text-info-strong' },
  brand: {
    bg: 'primary-soft',
    fg: 'primary-strong',
    className: 'bg-primary-soft text-primary-strong',
  },
  gold: {
    bg: 'rank-gold-soft',
    fg: 'rank-gold-strong',
    className: 'bg-rank-gold-soft text-rank-gold-strong',
  },
  silver: {
    bg: 'rank-silver-soft',
    fg: 'rank-silver-strong',
    className: 'bg-rank-silver-soft text-rank-silver-strong',
  },
  bronze: {
    bg: 'rank-bronze-soft',
    fg: 'rank-bronze-strong',
    className: 'bg-rank-bronze-soft text-rank-bronze-strong',
  },
} as const;

export type Tone = keyof typeof TONES;
