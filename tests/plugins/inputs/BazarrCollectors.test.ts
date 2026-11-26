import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { BazarrPlugin } from '../../../src/plugins/inputs/BazarrPlugin';
import { BazarrConfigSchema } from '../../../src/config/schemas/config.schema';
import type { BazarrConfig } from '../../../src/types/inputs/bazarr.types';
import type { components } from '../../../src/types/generated/bazarr';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type MovieHistoryItem = components['schemas']['MovieHistoryItem'];
type EpisodeHistoryItem = components['schemas']['EpisodeHistoryItem'];

const NOW = new Date('2026-11-26T10:30:00Z');
// Local Bazarr time after NOW whatever the test time zone (UTC-12 to UTC+14).
const LATER = '11/27/26 12:00:00';
const AFTER_LATER = new Date('2026-11-28T12:00:00Z');

type Key = 'wanted' | 'history' | 'status' | 'stats' | 'library';

function config(keys: Partial<Record<Key, boolean>>): BazarrConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return BazarrConfigSchema.parse({
    id: 1,
    url: 'http://bazarr.local:6767',
    apiKey: 'test-key',
    wanted: schedule(keys.wanted),
    history: schedule(keys.history),
    status: schedule(keys.status),
    stats: schedule(keys.stats),
    library: { enabled: keys.library ?? false, intervalDays: 1 },
  }) as BazarrConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
const queryOf = (client: ContractHttpClient, path: string): Record<string, unknown>[] =>
  client.get.mock.calls.filter((call) => call[0] === path).map((call) => (call[1] as { params: Record<string, unknown> }).params);
const movieHistory = (): MovieHistoryItem[] => loadFixture<{ data: MovieHistoryItem[] }>('bazarr/movies-history').data;
const episodeHistory = (): EpisodeHistoryItem[] => loadFixture<{ data: EpisodeHistoryItem[] }>('bazarr/episodes-history').data;
const newer = (count: number, from = 0): MovieHistoryItem[] =>
  Array.from({ length: count }, (_, i) => ({ ...movieHistory()[0], subs_id: `opensubtitlescom:${from + i}`, parsed_timestamp: LATER }));

describe('BazarrPlugin collectors', () => {
  let plugin: BazarrPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    useEventStateFolder(null);
    plugin = new BazarrPlugin();
    client = createContractHttpClient('bazarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('wanted', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ wanted: true }));
    });

    it('tags wanted subtitles with tags and series type', async () => {
      const wanted = ofType(await plugin.collect(), 'Wanted');
      const movies = wanted.filter((p) => p.tags.mediaType === 'movie');
      const episodes = wanted.filter((p) => p.tags.mediaType === 'episode');

      expect(movies.map((p) => p.tags.tags)).toEqual(['hd', 'hd', '4k,favorites']);
      expect(episodes.map((p) => p.tags.series_type)).toEqual(['standard', 'anime', 'anime']);
      expect(episodes.map((p) => p.tags.tags)).toEqual(['apple', 'apple', 'apple']);
    });

    it('tags wanted subtitles without tags as none', async () => {
      const { data } = loadFixture<{ data: components['schemas']['WantedMovie'][] }>('bazarr/movies-wanted');
      client.override('/api/movies/wanted', { data: [{ ...data[0], tags: [] }], total: 1 });

      const [movie] = ofType(await plugin.collect(), 'Wanted');

      expect(movie.tags.tags).toBe('none');
    });

    it('writes wanted totals', async () => {
      const [total] = ofType(await plugin.collect(), 'WantedTotal');

      expect(total.fields).toEqual({ movies: 2, episodes: 2 });
    });
  });

  describe('history', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ history: true }));
    });

    const history = async (): Promise<DataPoint[]> => ofType(await plugin.collect(), 'History');
    const later = (): void => {
      client.override('/api/movies/history', { data: [{ ...movieHistory()[0], parsed_timestamp: LATER }], total: 4 });
      client.override('/api/episodes/history', { data: episodeHistory(), total: 2 });
      vi.setSystemTime(AFTER_LATER);
    };

    it('emits each history event once', async () => {
      expect(await history()).toEqual([]);
      later();

      const points = await history();

      expect(points.map((p) => p.tags.name)).toEqual(['Heat - English']);
      expect(await history()).toEqual([]);
    });

    it('pages history back to the cursor', async () => {
      await history();
      vi.setSystemTime(AFTER_LATER);
      client.override('/api/movies/history', (params) =>
        Number(params?.start) === 0 ? { data: newer(100), total: 123 } : { data: [...newer(20, 100), ...movieHistory()], total: 123 }
      );
      client.get.mockClear();

      const points = (await history()).filter((p) => p.tags.mediaType === 'movie');

      expect(points).toHaveLength(120);
      expect(queryOf(client, '/api/movies/history')).toEqual([
        { start: 0, length: 100 },
        { start: 100, length: 100 },
      ]);
    });

    it('stops paging after 10 pages', async () => {
      await history();
      vi.setSystemTime(AFTER_LATER);
      client.override('/api/movies/history', (params) => ({ data: newer(100, Number(params?.start)), total: 5000 }));
      client.get.mockClear();

      const points = (await history()).filter((p) => p.tags.mediaType === 'movie');

      expect(points).toHaveLength(1000);
      expect(queryOf(client, '/api/movies/history')).toHaveLength(10);
    });

    it('skips history dates it cannot parse', async () => {
      await history();
      later();
      const [heat] = movieHistory();
      client.override('/api/movies/history', {
        data: [
          { ...heat, parsed_timestamp: LATER },
          { ...heat, subs_id: 'opensubtitlescom:2', parsed_timestamp: '27.11.26 12:00:00' },
        ],
        total: 2,
      });

      const points = (await history()).filter((p) => p.tags.mediaType === 'movie');

      expect(points).toHaveLength(1);
      expect((plugin as unknown as { logger: { debug: Mock } }).logger.debug).toHaveBeenCalledWith(
        'Skipped 1 Bazarr movie history events with an unparsable date'
      );
    });

    it('writes history match counts and flags', async () => {
      await history();
      later();
      client.override('/api/episodes/history', {
        data: episodeHistory().map((item) => ({ ...item, parsed_timestamp: LATER })),
        total: 2,
      });

      const points = await history();
      const heat = points.find((p) => p.tags.mediaType === 'movie');
      const french = points.find((p) => p.tags.languageCode === 'fra');

      expect(heat?.tags).toMatchObject({ forced: 0, hi: 0 });
      expect(heat?.fields).toMatchObject({ matches: 3, dont_matches: 1, upgradable: 0, blacklisted: 0 });
      expect(french?.tags).toMatchObject({ forced: 0, hi: 1 });
    });

    it('gives events of the same second distinct timestamps', async () => {
      await history();
      vi.setSystemTime(AFTER_LATER);
      client.override('/api/movies/history', { data: newer(2), total: 2 });

      const points = (await history()).filter((p) => p.tags.mediaType === 'movie');

      expect(new Set(points.map((p) => p.timestamp.getTime())).size).toBe(2);
    });

    it('consumes no history event when the episode request fails', async () => {
      await history();
      later();
      const episodes = episodeHistory();
      let calls = 0;
      client.override('/api/episodes/history', () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('Bazarr unavailable');
        }
        return { data: episodes, total: 2 };
      });

      await expect(plugin.collect()).rejects.toThrow('Bazarr unavailable');
      const points = await history();

      expect(points.map((p) => p.tags.name)).toEqual(['Heat - English']);
    });

    it('schedules the history collector', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Bazarr_1_history']);
    });
  });
});
