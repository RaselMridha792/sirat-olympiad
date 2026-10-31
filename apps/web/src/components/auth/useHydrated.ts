import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False during server rendering and before hydration, true after. The auth forms keep their submit button
 * disabled until then, so a form submitted before the JavaScript runs cannot post credentials natively.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
