/** Seconds since `startTime` (ISO string or epoch seconds); undefined when absent, unparsable or in the future. */
export function uptimeSeconds(startTime: string | number | null | undefined, now: Date): number | undefined {
  if (startTime === null || startTime === undefined || startTime === '') {
    return undefined;
  }
  const startMs = typeof startTime === 'number' ? startTime * 1000 : Date.parse(startTime);
  const seconds = Math.floor((now.getTime() - startMs) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
