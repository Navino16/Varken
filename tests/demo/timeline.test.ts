import { describe, it, expect } from 'vitest';
import { activity, eventsIn, random, utcDays, utcMonths } from './timeline';

const HOUR = 3_600_000;

describe('random', () => {
  it('is deterministic per key and stays in [0, 1)', () => {
    expect(random('a')).toBe(random('a'));
    expect(random('a')).not.toBe(random('b'));
    for (let i = 0; i < 1000; i++) {
      const value = random(`k${i}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('activity', () => {
  it('peaks in the evening and is lowest at night', () => {
    expect(activity(Date.parse('2026-11-25T21:00:00Z'))).toBe(1);
    expect(activity(Date.parse('2026-11-25T04:00:00Z'))).toBe(0.05);
  });

  it('is higher on weekends', () => {
    expect(activity(Date.parse('2026-11-28T04:00:00Z'))).toBeCloseTo(0.25);
    expect(activity(Date.parse('2026-11-28T21:00:00Z'))).toBe(1);
  });
});

describe('eventsIn', () => {
  const from = Date.parse('2026-11-20T00:00:00Z');
  const to = from + 48 * HOUR;

  it('only returns events inside (from, to]', () => {
    const events = eventsIn('r', from + 30 * 60_000, to - 30 * 60_000, 4);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.at).toBeGreaterThan(from + 30 * 60_000);
      expect(event.at).toBeLessThanOrEqual(to - 30 * 60_000);
    }
  });

  it('gives unique ids sorted by time', () => {
    const events = eventsIn('r', from, to, 4);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
  });

  it('returns the same events for overlapping windows', () => {
    const first = eventsIn('r', from, from + 30 * HOUR, 4);
    const second = eventsIn('r', from + 6 * HOUR, to, 4);
    const common = (e: { at: number }): boolean => e.at > from + 6 * HOUR && e.at <= from + 30 * HOUR;
    expect(first.filter(common).map(({ at, id }) => ({ at, id }))).toEqual(second.filter(common).map(({ at, id }) => ({ at, id })));
  });

  it('differs per route', () => {
    expect(eventsIn('a', from, to, 4).map((e) => e.at)).not.toEqual(eventsIn('b', from, to, 4).map((e) => e.at));
  });
});

describe('utcDays and utcMonths', () => {
  it('lists the last days, today last', () => {
    expect(utcDays(Date.parse('2026-12-02T12:00:00Z'), 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('lists the last months across a year boundary', () => {
    expect(utcMonths(Date.parse('2026-01-10T00:00:00Z'), 3)).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026']);
  });
});
