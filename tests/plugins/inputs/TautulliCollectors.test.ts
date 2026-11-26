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

    it('emits a day once a full day after it ends', async () => {
      datePlays(25);
      expect(ofType(await plugin.collect(), 'PlaysByDate')).toEqual([]);

      vi.setSystemTime(new Date('2026-11-26T00:10:00Z'));
      datePlays(26);
      expect(ofType(await plugin.collect(), 'PlaysByDate').map((p) => p.timestamp.toISOString())).toEqual(['2026-11-24T00:00:00.000Z']);

      vi.setSystemTime(new Date('2026-11-27T00:10:00Z'));
      datePlays(27);
      const points = ofType(await plugin.collect(), 'PlaysByDate');

      expect(points.map((p) => [p.timestamp.toISOString(), p.fields])).toEqual([['2026-11-25T00:00:00.000Z', { tv: 5, total: 5 }]]);
      vi.setSystemTime(new Date('2026-11-27T00:20:00Z'));
      expect(ofType(await plugin.collect(), 'PlaysByDate')).toEqual([]);
      expect(queryOf(client, cmd('get_plays_by_date'))[0]).toMatchObject({ time_range: 7 });
      expect(queryOf(client, cmd('get_plays_per_month'))[0]).toMatchObject({ time_range: 3 });
    });

    it('keeps the startup day when Tautulli runs west of UTC', async () => {
      plugin = new TautulliPlugin();
      vi.setSystemTime(new Date('2026-11-26T02:00:00Z'));
      await plugin.initialize(config({ stats: true }));
      datePlays(25);
      await plugin.collect();

      vi.setSystemTime(new Date('2026-11-27T06:00:00Z'));
      datePlays(26);

      expect(ofType(await plugin.collect(), 'PlaysByDate').map((p) => p.timestamp.toISOString())).toEqual(['2026-11-25T00:00:00.000Z']);
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

      expect(ofType(points, 'PlaysByStreamType').map((p) => p.fields)).toEqual([{ direct_play: 1, direct_stream: 0, transcode: 1 }]);
      expect(ofType(points, 'ConcurrentStreams').map((p) => p.fields)).toEqual([
        { direct_play: 1, direct_stream: 0, transcode: 1, max_concurrent_streams: 1 },
      ]);
    });

    it('logs graph categories it cannot parse', async () => {
      client.override(cmd('get_plays_per_month'), {
        response: { result: 'success', message: null, data: { categories: ['Okt. 2026', 'Nov. 2026'], series: [{ name: 'TV', data: [1, 2] }] } },
      });
      await plugin.collect();
      const debug = (plugin as unknown as { logger: { debug: Mock } }).logger.debug;

      expect(debug).toHaveBeenCalledWith(expect.stringContaining('Okt. 2026'));
    });

    it('runs home stats and graphs at most every 5 minutes', async () => {
      expect(ofType(await plugin.collect(), 'HomeStat')).not.toEqual([]);

      vi.setSystemTime(new Date(NOW.getTime() + 30_000));
      const points = await plugin.collect();
      expect(ofType(points, 'HomeStat')).toEqual([]);
      expect(ofType(points, 'library_stats')).not.toEqual([]);

      vi.setSystemTime(new Date(NOW.getTime() + 300_000));
      expect(ofType(await plugin.collect(), 'HomeStat')).not.toEqual([]);
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
      vi.setSystemTime(new Date(NOW.getTime() + 1_200_000));
      expect(ofType(await plugin.collect(), 'RecentlyAdded')).toEqual([]);
      expect(queryOf(client, cmd('get_recently_added'))[0]).toMatchObject({ count: '50' });
    });

    it('hashes recently added items with their added time', async () => {
      const body = loadFixture('tautulli/get-recently-added') as { response: { data: { recently_added: { added_at: string }[] } } };
      body.response.data.recently_added[0].added_at = String(NOW_S + 300);
      client.override(cmd('get_recently_added'), body as never);
      vi.setSystemTime(new Date(NOW.getTime() + 600_000));
      const [first] = ofType(await plugin.collect(), 'RecentlyAdded');

      body.response.data.recently_added[0].added_at = String(NOW_S + 900);
      client.override(cmd('get_recently_added'), body as never);
      vi.setSystemTime(new Date(NOW.getTime() + 1_200_000));
      const [second] = ofType(await plugin.collect(), 'RecentlyAdded');

      expect(second.fields.hash).not.toBe(first.fields.hash);
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
  describe('history', () => {
    beforeEach(async () => {
      vi.setSystemTime(new Date('2026-11-25T09:30:00Z'));
      await plugin.initialize(config({ history: true }));
      vi.setSystemTime(NOW);
    });

    it('emits one Play point per history row', async () => {
      const plays = ofType(await plugin.collect(), 'Play');

      expect(plays.map((p) => [p.tags, p.fields])).toEqual([
        [
          {
            type: 'Play',
            server: 1,
            media_type: 'movie',
            rating_key: 101,
            user_id: 133788,
            username: 'jon',
            platform: 'Android',
            player: 'SHIELD',
            product: 'Plex for Android (TV)',
            transcode_decision: 'Direct play',
            network: 'lan',
            live: 0,
          },
          { hash: expect.any(String), title: 'Inception', play_duration_seconds: 9540, paused_seconds: 60, percent_complete: 98, watched_status: 1 },
        ],
        [
          {
            type: 'Play',
            server: 1,
            media_type: 'episode',
            rating_key: 2001,
            user_id: 133789,
            username: 'arya',
            platform: 'Android',
            player: 'SHIELD',
            product: 'Plex for Android (TV)',
            transcode_decision: 'Transcode',
            network: 'wan',
            live: 0,
          },
          {
            hash: expect.any(String),
            title: 'Game of Thrones - Winter Is Coming',
            play_duration_seconds: 5940,
            paused_seconds: 60,
            percent_complete: 60,
            watched_status: 0.5,
          },
        ],
      ]);
      expect(plays.map((p) => p.timestamp.getTime() - (NOW_S - 1200) * 1000)).toEqual([3, 2]);
      expect(plays[1].floatFields).toContain('watched_status');
    });

    it('does not re-emit plays on the next poll', async () => {
      await plugin.collect();

      expect(ofType(await plugin.collect(), 'Play')).toEqual([]);
    });

    it('asks history ordered by stop time', async () => {
      await plugin.collect();

      expect(queryOf(client, cmd('get_history'))[0]).toMatchObject({
        grouping: 0,
        include_activity: 0,
        order_column: 'stopped',
        order_dir: 'desc',
        length: 500,
      });
    });

    it('skips rows without a stop time', async () => {
      const body = loadFixture('tautulli/get-history') as { response: { data: { data: { stopped: number | null }[] } } };
      body.response.data.data[0].stopped = null;
      client.override(cmd('get_history'), body as never);

      expect(ofType(await plugin.collect(), 'Play').map((p) => p.fields.title)).toEqual(['Game of Thrones - Winter Is Coming']);
    });

    it('writes live TV plays with the live media type', async () => {
      const body = loadFixture('tautulli/get-history') as { response: { data: { data: { live: number }[] } } };
      body.response.data.data[0].live = 1;
      client.override(cmd('get_history'), body as never);

      expect(ofType(await plugin.collect(), 'Play').map((p) => p.tags.media_type)).toEqual(['live', 'episode']);
    });

    it('never emits history IP addresses', async () => {
      expect(valuesOf(await plugin.collect())).not.toContain('203.0.113.9');
    });

    it('schedules the history collector', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Tautulli_1_history']);
    });
  });
  describe('users', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ users: true }));
      client.override(cmd('get_user_watch_time_stats'), (params) => {
        const body = loadFixture('tautulli/get-user-watch-time-stats') as { response: { data: { total_plays: number }[] } };
        if (params?.user_id === '133789') {
          for (const row of body.response.data) {
            row.total_plays += 100;
          }
        }
        return body;
      });
    });

    it('collects users with watch time', async () => {
      const users = ofType(await plugin.collect(), 'User');

      expect(users.map((p) => [p.tags, p.fields])).toEqual([
        [
          { type: 'User', server: 1, user_id: 133788, username: 'jon', friendly_name: 'Jon Snow' },
          {
            plays: 40,
            duration_seconds: 144000,
            last_seen_age_seconds: 3600,
            is_active: 1,
            allow_guest: 0,
            keep_history: 1,
            plays_1d: 1,
            watch_seconds_1d: 3600,
            plays_7d: 5,
            watch_seconds_7d: 18000,
            plays_30d: 20,
            watch_seconds_30d: 72000,
            plays_all: 40,
            watch_seconds_all: 144000,
          },
        ],
        [
          { type: 'User', server: 1, user_id: 133789, username: 'arya', friendly_name: 'Arya Stark' },
          expect.objectContaining({ plays: 12, last_seen_age_seconds: 864000, is_active: 0, allow_guest: 1, plays_1d: 101, plays_all: 140 }),
        ],
      ]);
      expect(queryOf(client, cmd('get_users_table'))[0]).toMatchObject({ length: 10000 });
      expect(queryOf(client, cmd('get_user_watch_time_stats'))).toEqual([
        expect.objectContaining({ user_id: '133788', query_days: '1,7,30,0' }),
        expect.objectContaining({ user_id: '133789', query_days: '1,7,30,0' }),
      ]);
    });

    it('never emits user emails or IP addresses', async () => {
      const values = valuesOf(await plugin.collect());

      for (const secret of ['jon@example.com', 'arya@example.com', '192.168.1.20', '203.0.113.9']) {
        expect(values).not.toContain(secret);
      }
    });

    it('counts users seen within 24 hours and 30 days', async () => {
      expect(ofType(await plugin.collect(), 'Users')[0].fields).toEqual({ users: 2, active: 1, seen_24h: 1, seen_30d: 2 });
    });

    it('schedules the users collector', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Tautulli_1_users', 300]]);
    });
  });
  describe('libraryMedia', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ libraryMedia: true }));
    });

    it('collects library watch time and media totals', async () => {
      const libraries = ofType(await plugin.collect(), 'Library');

      expect(libraries.map((p) => p.tags)).toEqual([
        { type: 'Library', server: 1, section_id: 1, section_name: 'Movies', section_type: 'movie' },
        { type: 'Library', server: 1, section_id: 2, section_name: 'TV Shows', section_type: 'show' },
        { type: 'Library', server: 1, section_id: 999999, section_name: 'Live TV', section_type: 'live' },
      ]);
      expect(libraries[0].fields).toEqual({
        plays: 120,
        duration_seconds: 864000,
        last_accessed_age_seconds: 3600,
        is_active: 1,
        keep_history: 1,
        plays_1d: 2,
        watch_seconds_1d: 7200,
        plays_7d: 9,
        watch_seconds_7d: 30600,
        plays_30d: 31,
        watch_seconds_30d: 111600,
        plays_all: 120,
        watch_seconds_all: 864000,
        media_items: 3,
        file_size: 74000000000,
        media_info_age_seconds: 21600,
      });
      expect(queryOf(client, cmd('get_library_watch_time_stats')).map((q) => [q.section_id, q.query_days])).toEqual([
        ['1', '1,7,30,0'],
        ['2', '1,7,30,0'],
        ['999999', '1,7,30,0'],
      ]);
    });

    it('groups media info by resolution and codec', async () => {
      const media = ofType(await plugin.collect(), 'MediaInfo').filter((p) => p.tags.section_id === 1);

      expect(media.map((p) => [p.tags.video_resolution, p.tags.video_codec, p.fields])).toEqual([
        ['1080', 'h264', { items: 2, file_size: 22000000000 }],
        ['4k', 'hevc', { items: 1, file_size: 52000000000 }],
      ]);
      expect(queryOf(client, cmd('get_library_media_info'))[0]).toMatchObject({ section_id: '1', length: 100000 });
    });

    it('skips media info for live sections', async () => {
      const points = await plugin.collect();

      expect(queryOf(client, cmd('get_library_media_info')).map((q) => q.section_id)).toEqual(['1', '2']);
      expect(ofType(points, 'MediaInfo').some((p) => p.tags.section_id === 999999)).toBe(false);
      expect(ofType(points, 'Library')[2].fields).not.toHaveProperty('media_items');
    });

    it('keeps the library point when media info was never built', async () => {
      client.override(cmd('get_library_media_info'), {
        response: {
          result: 'success',
          message: null,
          data: { draw: 0, recordsTotal: 0, recordsFiltered: 0, filtered_file_size: 0, total_file_size: 0, last_refreshed: null, data: [] },
        },
      });
      const points = await plugin.collect();

      expect(ofType(points, 'Library')[0].fields).not.toHaveProperty('media_items');
      expect(ofType(points, 'Library')[0].fields).toHaveProperty('plays', 120);
      expect(ofType(points, 'MediaInfo')).toEqual([]);
    });

    const mediaInfo = (lastRefreshed: number, rows?: Record<string, unknown>[]): unknown => {
      const body = loadFixture('tautulli/get-library-media-info') as { response: { data: Record<string, unknown> } };
      body.response.data.last_refreshed = lastRefreshed;
      if (rows) {
        Object.assign(body.response.data, { data: rows, recordsTotal: rows.length, recordsFiltered: rows.length, total_file_size: 0, filtered_file_size: 0 });
      }
      return body;
    };

    it('omits the size of libraries whose items have no known size', async () => {
      const shows = [
        { section_id: 2, section_type: 'show', media_type: 'show', rating_key: '300', title: 'Severance', video_resolution: '', video_codec: '', file_size: '' },
        { section_id: 2, section_type: 'show', media_type: 'show', rating_key: '301', title: 'Andor', video_resolution: '', video_codec: '', file_size: '' },
      ];
      client.override(cmd('get_library_media_info'), (params) => (params?.section_id === '2' ? mediaInfo(NOW_S - 3600, shows) : mediaInfo(NOW_S - 3600)));
      const points = await plugin.collect();
      const tv = ofType(points, 'Library')[1];

      expect(tv.fields).toMatchObject({ media_items: 2 });
      expect(tv.fields).not.toHaveProperty('file_size');
      expect(ofType(points, 'MediaInfo').filter((p) => p.tags.section_id === 2).map((p) => [p.tags.video_resolution, p.fields])).toEqual([
        ['unknown', { items: 2 }],
      ]);
    });

    it('refreshes a stale movie media info cache', async () => {
      client.override(cmd('get_library_media_info'), (params) => mediaInfo(params?.refresh === 'true' ? NOW_S : NOW_S - 2 * 86400));
      const points = await plugin.collect();

      expect(queryOf(client, cmd('get_library_media_info')).map((q) => [q.section_id, q.refresh])).toEqual([
        ['1', undefined],
        ['2', undefined],
        ['1', 'true'],
      ]);
      expect(ofType(points, 'Library')[0].fields.media_info_age_seconds).toBe(0);
    });

    it('keeps the cached media info when the refresh fails', async () => {
      client.override(cmd('get_library_media_info'), (params) => {
        if (params?.refresh === 'true') {
          throw new Error('timeout of 30000ms exceeded');
        }
        return mediaInfo(NOW_S - 2 * 86400);
      });
      const points = await plugin.collect();

      expect(ofType(points, 'Library')[0].fields).toMatchObject({ media_items: 3, media_info_age_seconds: 2 * 86400 });
    });

    it('schedules the libraryMedia collector in days', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Tautulli_1_libraryMedia', 86400]]);
    });
  });
});
