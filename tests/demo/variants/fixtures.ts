import { findRoute, loadFixture } from '../../contracts/registry';
import type { ServiceId } from '../../contracts/lib/spec';
import { activity, eventsIn, random, type DemoEvent } from '../timeline';

export const HOUR = 3_600_000;
const LOOKBACK = 24 * HOUR;

/** Fresh copy of the fixture registered for a route. */
export function fixtureOf<T>(service: ServiceId, path: string): T {
  const route = findRoute(service, 'get', path);
  if (!route) {
    throw new Error(`No contract route for ${service} ${path}`);
  }
  return loadFixture<T>(route.fixture);
}

/** Events of the last 24 h: the plugin's high-water mark drops those it already emitted. */
export function recentEvents(route: string, perHour: number): DemoEvent[] {
  const now = Date.now();
  return eventsIn(route, now - LOOKBACK, now, perHour);
}

/** Live sessions now, following the usage curve, between 0 and `max`. */
export function liveCount(service: string, max: number): number {
  const now = Date.now();
  return Math.min(max, Math.round(max * activity(now) * (0.7 + 0.6 * random(`${service}|sessions|${now}`))));
}

/** `count` items cycling through `items`, `rename(item, k)` applied to copies past the fixture's own. */
export function cycle<T>(items: readonly T[], count: number, rename: (item: T, k: number) => void): T[] {
  return Array.from({ length: items.length === 0 ? 0 : count }, (_, k) => {
    const item = structuredClone(items[k % items.length]);
    if (k >= items.length) {
      rename(item, k);
    }
    return item;
  });
}

/** Fixture value scaled by a deterministic factor in [0.6, 1.4). */
export function around(value: number, key: string): number {
  return Math.round(value * (0.6 + 0.8 * random(key)));
}

export const epochSeconds = (ms: number): number => Math.floor(ms / 1000);
