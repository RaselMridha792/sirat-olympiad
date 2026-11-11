export const SECOND = 1000;

/** Whole days, hours, minutes and seconds until `target`; all 0 once it has passed. Pure, for node --test. */
export function countdownParts(target: number, now: number) {
  const left = Math.max(0, Math.floor((target - now) / SECOND));
  return {
    done: left === 0,
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3_600),
    minutes: Math.floor((left % 3_600) / 60),
    seconds: left % 60,
  };
}
