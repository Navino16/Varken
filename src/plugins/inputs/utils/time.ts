const MIN_VALID_TIME = Date.UTC(2000, 0, 1);

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Epoch ms of a .NET API time; `DateTime.MinValue` (never happened) and unparsable values are undefined.
 * A time without zone designator is a UTC `DateTime` read back from a database with an unspecified kind.
 */
export function dotnetTime(value: string | null | undefined): number | undefined {
  const text = value ?? '';
  const time = Date.parse(/T\d/.test(text) && !ZONED.test(text) ? `${text}Z` : text);
  return Number.isFinite(time) && time >= MIN_VALID_TIME ? time : undefined;
}

export function ageSeconds(time: number | undefined, now: Date): number | undefined {
  return time === undefined ? undefined : Math.floor((now.getTime() - time) / 1000);
}
