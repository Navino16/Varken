import type { JsonResponse } from '../../../src/types/api-contract';
import type { paths } from '../../../src/types/generated/bazarr';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { random, utcDays } from '../timeline';
import { fixtureOf, recentEvents } from './fixtures';

type MovieHistory = JsonResponse<paths, '/movies/history'>;
type EpisodeHistory = JsonResponse<paths, '/episodes/history'>;
type Stats = JsonResponse<paths, '/history/stats'>;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Bazarr's `MM/DD/YY HH:MM:SS`, read by the plugin in the process timezone (UTC while seeding). */
function bazarrTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear() % 100)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** The last day's events, newest first like Bazarr, each a fixture item with a new time. */
function recentHistory<T extends MovieHistory | EpisodeHistory>(kind: 'movies' | 'episodes'): T {
  const body = fixtureOf<T>('bazarr', `/api/${kind}/history`);
  const items = body.data ?? [];
  const data = recentEvents(`bazarr|${kind}`, 1)
    .reverse()
    .map((event) => ({ ...items[event.index % items.length], parsed_timestamp: bazarrTime(event.at) }));
  return { ...body, data, total: data.length };
}

export function bazarrVariants(client: ContractHttpClient): void {
  client.override('/api/movies/history', () => recentHistory<MovieHistory>('movies'));
  client.override('/api/episodes/history', () => recentHistory<EpisodeHistory>('episodes'));
  client.override('/api/history/stats', () => {
    const stats = fixtureOf<Stats>('bazarr', '/api/history/stats');
    const days = (kind: 'series' | 'movies'): { date: string; count: number }[] =>
      utcDays(Date.now(), stats[kind]?.length ?? 7).map((date) => ({ date, count: Math.floor(random(`bazarr|stats|${kind}|${date}`) * 8) }));
    return { ...stats, series: days('series'), movies: days('movies') };
  });
}
