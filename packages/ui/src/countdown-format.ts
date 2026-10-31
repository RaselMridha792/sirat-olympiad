/** Seconds as mm:ss, or h:mm:ss from one hour on (an exam room can wait for hours before a window opens). */
export function formatCountdown(totalSeconds: number): string {
  const left = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(left / 3600);
  const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
