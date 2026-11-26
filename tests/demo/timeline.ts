const HOUR = 3_600_000;
const HOURLY = [0.3, 0.2, 0.1, 0.1, 0.05, 0.05, 0.1, 0.2, 0.3, 0.3, 0.35, 0.4, 0.5, 0.45, 0.4, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1, 0.8, 0.5];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Deterministic value in [0, 1) for a key: FNV-1a hash seeding one mulberry32 draw. */
export function random(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  }
  let t = (hash + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

/** Share of peak usage at a time: evening peak, night trough, a bit more on weekends (UTC). */
export function activity(ms: number): number {
  const date = new Date(ms);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.2 : 0;
  return Math.min(1, HOURLY[date.getUTCHours()] + weekend);
}

export interface DemoEvent {
  at: number;
  id: number;
  /** Stable per event, picks the fixture item to clone. */
  index: number;
}

/**
 * Events of a route in (from, to], the same whatever window asks for them. Whole seconds like the APIs, and
 * `at + 999 <= to` since eventTimestamp adds up to 999 ms of id: a point after the clock would push the event mark ahead.
 */
export function eventsIn(route: string, from: number, to: number, perHour: number): DemoEvent[] {
  const events: DemoEvent[] = [];
  for (let slot = Math.floor(from / HOUR) * HOUR; slot <= to; slot += HOUR) {
    const hour = slot / HOUR;
    const count = Math.floor(perHour * activity(slot) + random(`${route}|${slot}`));
    for (let i = 0; i < count; i++) {
      const at = slot + Math.floor(random(`${route}|${slot}|${i}`) * 3600) * 1000;
      if (at > from && at + 999 <= to) {
        events.push({ at, id: hour * 100 + i, index: hour + i });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at || a.id - b.id);
}

/** `YYYY-MM-DD` of the last `count` UTC days, today last. */
export function utcDays(now: number, count: number): string[] {
  const today = Math.floor(now / (24 * HOUR));
  return Array.from({ length: count }, (_, i) => new Date((today - count + 1 + i) * 24 * HOUR).toISOString().slice(0, 10));
}

/** `Mon YYYY` of the last `count` UTC months, the current one last. */
export function utcMonths(now: number, count: number): string[] {
  const date = new Date(now);
  const current = date.getUTCFullYear() * 12 + date.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const month = current - count + 1 + i;
    return `${MONTHS[month % 12]} ${Math.floor(month / 12)}`;
  });
}
