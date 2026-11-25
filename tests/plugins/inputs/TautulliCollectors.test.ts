import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { TautulliPlugin } from '../../../src/plugins/inputs/TautulliPlugin';
import { TautulliConfigSchema } from '../../../src/config/schemas/config.schema';
import type { TautulliConfig } from '../../../src/types/inputs/tautulli.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const NOW = new Date('2026-11-25T10:30:00Z');
const NOW_S = NOW.getTime() / 1000;
const cmd = (name: string): string => `/api/v2?cmd=${name}`;

type Key = 'stats' | 'history' | 'users' | 'libraryMedia';

function config(keys: Partial<Record<Key, boolean>>): TautulliConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return TautulliConfigSchema.parse({
    id: 1,
    url: 'http://tautulli.local:8181',
    apiKey: 'test-key',
    stats: schedule(keys.stats),
    history: schedule(keys.history),
    users: schedule(keys.users),
    libraryMedia: { enabled: keys.libraryMedia ?? false, intervalDays: 1 },
  }) as TautulliConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
const queryOf = (client: ContractHttpClient, path: string): Record<string, unknown>[] =>
  client.get.mock.calls.filter((call) => call[0] === path).map((call) => (call[1] as { params: Record<string, unknown> }).params);
const valuesOf = (points: DataPoint[]): unknown[] => points.flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);

describe('TautulliPlugin collectors', () => {
  let plugin: TautulliPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    useEventStateFolder(null);
    plugin = new TautulliPlugin();
    client = createContractHttpClient('tautulli');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stats', () => {
    const days = (last: number): string[] => Array.from({ length: 7 }, (_, i) => `2026-11-${String(last - 6 + i).padStart(2, '0')}`);
    const datePlays = (last: number): void =>
      client.override(cmd('get_plays_by_date'), {
        response: {
          result: 'success',
          message: null,
          data: { categories: days(last), series: [{ name: 'TV', data: [1, 2, 3, 4, 5, 6, 7] }, { name: 'Total', data: [1, 2, 3, 4, 5, 6, 7] }] },
        },
      });

    beforeEach(async () => {
      await plugin.initialize(config({ stats: true }));
    });

    it('keeps library stats on the stats collector', async () => {
      expect(ofType(await plugin.collect(), 'library_stats').length).toBeGreaterThan(0);
    });

    it('collects home stats', async () => {
      const points = ofType(await plugin.collect(), 'HomeStat');

      expect(points.map((p) => [p.tags.stat_id, p.tags.rank, p.fields.title, p.fields.plays ?? p.fields.count])).toEqual([
        ['top_movies', 1, 'Inception', 12],
        ['top_movies', 2, 'Arrival', 7],
        ['top_users', 1, 'Jon Snow', 40],
        ['top_platforms', 1, 'Android', 25],
        ['most_concurrent', 1, 'Concurrent Streams', 3],
        ['most_concurrent', 2, 'Concurrent Transcodes', 1],
      ]);
      expect(queryOf(client, cmd('get_home_stats'))[0]).toMatchObject({ time_range: 30, stats_count: 5 });
    });

    it('collects snapshot graphs', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'PlaysByDayOfWeek').find((p) => p.tags.day === 'Saturday')?.fields).toEqual({ tv: 9, movies: 4 });
      expect(ofType(points, 'PlaysByHourOfDay')).toHaveLength(24);
      expect(ofType(points, 'StreamTypeByPlatform').find((p) => p.tags.platform === 'Chrome')?.fields).toEqual({
        direct_play: 4,
        direct_stream: 1,
        transcode: 6,
      });
      expect(ofType(points, 'StreamTypeByUser').map((p) => p.tags.user)).toEqual(['Jon Snow', 'Arya Stark']);
      expect(queryOf(client, cmd('get_plays_by_dayofweek'))[0]).toMatchObject({ time_range: 30 });
    });

    it('emits a completed day once', async () => {
      datePlays(25);
      expect(ofType(await plugin.collect(), 'PlaysByDate')).toEqual([]);

      vi.setSystemTime(new Date('2026-11-26T00:10:00Z'));
      datePlays(26);
      const points = ofType(await plugin.collect(), 'PlaysByDate');

      expect(points.map((p) => [p.timestamp.toISOString(), p.fields])).toEqual([['2026-11-25T00:00:00.000Z', { tv: 6, total: 6 }]]);
      expect(ofType(await plugin.collect(), 'PlaysByDate')).toEqual([]);
      expect(queryOf(client, cmd('get_plays_by_date'))[0]).toMatchObject({ time_range: 7 });
      expect(queryOf(client, cmd('get_plays_per_month'))[0]).toMatchObject({ time_range: 3 });
    });

    it('emits stream type and concurrency buckets', async () => {
      await plugin.collect();
      vi.setSystemTime(new Date('2026-11-26T00:10:00Z'));
      const shift = (name: string): void => {
        const body = loadFixture('tautulli/' + name.replace(/_/g, '-')) as { response: { data: { categories: string[] } } };
        body.response.data.categories = days(26);
        client.override(cmd(name), body as never);
      };
      shift('get_plays_by_stream_type');
      shift('get_concurrent_streams_by_stream_type');
      const points = await plugin.collect();

      expect(ofType(points, 'PlaysByStreamType').map((p) => p.fields)).toEqual([{ direct_play: 5, direct_stream: 1, transcode: 1 }]);
      expect(ofType(points, 'ConcurrentStreams').map((p) => p.fields)).toEqual([
        { direct_play: 2, direct_stream: 1, transcode: 1, max_concurrent_streams: 3 },
      ]);
    });

    it('emits recently added items once', async () => {
      expect(ofType(await plugin.collect(), 'RecentlyAdded')).toEqual([]);

      const body = loadFixture('tautulli/get-recently-added') as { response: { data: { recently_added: { added_at: string }[] } } };
      body.response.data.recently_added[0].added_at = String(NOW_S + 300);
      client.override(cmd('get_recently_added'), body as never);
      vi.setSystemTime(new Date(NOW.getTime() + 600_000));
      const points = ofType(await plugin.collect(), 'RecentlyAdded');

      expect(points.map((p) => [p.tags, p.fields])).toEqual([
        [
          { type: 'RecentlyAdded', server: 1, media_type: 'movie', section_id: '1', library_name: 'Movies', rating_key: '104' },
          { hash: expect.any(String), title: 'Dune: Part Two', year: 2024 },
        ],
      ]);
      expect(points[0].timestamp.getTime()).toBe((NOW_S + 300) * 1000 + 104);
      expect(ofType(await plugin.collect(), 'RecentlyAdded')).toEqual([]);
      expect(queryOf(client, cmd('get_recently_added'))[0]).toMatchObject({ count: '50' });
    });

    it('consumes no event when one stats request fails', async () => {
      datePlays(25);
      await plugin.collect();
      vi.setSystemTime(new Date('2026-11-26T00:10:00Z'));
      datePlays(26);
      let calls = 0;
      client.override(cmd('get_plays_per_month'), () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('Request failed with status code 500');
        }
        return loadFixture('tautulli/get-plays-per-month');
      });
      await expect(plugin.collect()).rejects.toThrow('500');

      expect(ofType(await plugin.collect(), 'PlaysByDate')).toHaveLength(1);
    });

    it('schedules the stats collector', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Tautulli_1_stats']);
    });
  });
});
