/** A period of an aggregate (plays per day, subtitles per day…), written once as an event point. */
export interface Bucket {
  category: string;
  /** Epoch ms, UTC. */
  start: number;
  end: number;
  fields: Record<string, number>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` days and `Mon YYYY` months (English abbreviations) as UTC ranges; anything else is undefined. */
export function bucketRange(category: string, unit: 'day' | 'month'): { start: number; end: number } | undefined {
  if (unit === 'day') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(category);
    if (!match) {
      return undefined;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
    const start = Date.UTC(year, month, day);
    const date = new Date(start);
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) {
      return undefined;
    }
    return { start, end: Date.UTC(year, month, day + 1) };
  }
  const match = /^([A-Za-z]{3}) (\d{4})$/.exec(category);
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month < 0) {
    return undefined;
  }
  const year = Number(match[2]);
  return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
}
