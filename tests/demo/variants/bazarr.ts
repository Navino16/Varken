import type { ContractHttpClient } from '../../fixtures/contract-http';
import { random, utcDays } from '../timeline';
import { fixtureOf, recentEvents } from './fixtures';

type Item = Record<string, unknown>;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Bazarr's `MM/DD/YY HH:MM:SS`, read by the plugin in the process timezone (UTC while seeding). */
function bazarrTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear() % 100)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function bazarrVariants(client: ContractHttpClient): void {
  for (const kind of ['movies', 'episodes']) {
    const path = `/api/${kind}/history`;
    client.override(path, () => {
      const body = fixtureOf<{ data: Item[]; total: number }>('bazarr', path);
      const items = body.data;
      body.data = recentEvents(`bazarr|${kind}`, 1)
        .reverse()
        .map((event) => ({ ...items[event.index % items.length], parsed_timestamp: bazarrTime(event.at) }));
      body.total = body.data.length;
      return body;
    });
  }

  client.override('/api/history/stats', () => {
    const stats = fixtureOf<Record<'series' | 'movies', { date: string; count: number }[]>>('bazarr', '/api/history/stats');
    for (const kind of ['series', 'movies'] as const) {
      stats[kind] = utcDays(Date.now(), stats[kind].length).map((date) => ({ date, count: Math.floor(random(`bazarr|stats|${kind}|${date}`) * 8) }));
    }
    return stats;
  });
}
