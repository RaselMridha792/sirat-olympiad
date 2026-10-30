import type { Locale } from './index';

/**
 * Typed message dictionaries. Each feature keeps its strings in its own module
 * (`defineMessages({ en: {...}, bn: {...} })`), so parallel work never edits a shared JSON file.
 * `bn` must have exactly the keys (and function signatures) of `en`: a missing or extra key is a
 * compile error. Function leaves format values that the caller has already localized
 * (e.g. numbers from formatNumber), and are for Server Components only (not serializable).
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { readonly [K in keyof T]: Widen<T[K]> };

export type Messages<M extends { en: unknown }> = M['en'];

export function defineMessages<const T>(messages: { en: T; bn: NoInfer<Widen<T>> }): {
  en: Widen<T>;
  bn: Widen<T>;
} {
  return messages as { en: Widen<T>; bn: Widen<T> };
}

export function pick<M extends { en: unknown; bn: unknown }>(messages: M, locale: Locale): M['en'] {
  return (locale === 'bn' ? messages.bn : messages.en) as M['en'];
}
