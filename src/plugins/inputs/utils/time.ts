const MIN_VALID_TIME = Date.UTC(2000, 0, 1);

/** Epoch ms of a .NET API time; `DateTime.MinValue` (never happened) and unparsable values are undefined. */
export function dotnetTime(value: string | null | undefined): number | undefined {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time >= MIN_VALID_TIME ? time : undefined;
}

export function ageSeconds(time: number | undefined, now: Date): number | undefined {
  return time === undefined ? undefined : Math.floor((now.getTime() - time) / 1000);
}
