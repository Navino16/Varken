import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { BazarrPlugin } from '../../../src/plugins/inputs/BazarrPlugin';
import type { BazarrConfig } from '../../../src/types/inputs/bazarr.types';
import type { components } from '../../../src/types/generated/bazarr';
import type { DataPoint } from '../../../src/types/plugin.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type WantedMovie = components['schemas']['WantedMovie'];
type MovieHistoryItem = components['schemas']['MovieHistoryItem'];

const ROUTES = ['/api/movies/wanted', '/api/episodes/wanted', '/api/movies/history', '/api/episodes/history'];
const wantedMovies = (): WantedMovie[] => loadFixture<{ data: WantedMovie[] }>('bazarr/movies-wanted').data;
const movieHistory = (): MovieHistoryItem[] => loadFixture<{ data: MovieHistoryItem[] }>('bazarr/movies-history').data;

const ofKind = (points: DataPoint[], type: string, mediaType: string): DataPoint[] =>
  points.filter((p) => p.tags.type === type && p.tags.mediaType === mediaType);

describe('BazarrPlugin', () => {
  let plugin: BazarrPlugin;
  let client: ContractHttpClient;

  const testConfig: BazarrConfig = {
    id: 1,
    url: 'http://localhost:6767',
    apiKey: 'bazarr-api-key',
    verifySsl: false,
    wanted: { enabled: true, intervalSeconds: 300 },
    history: { enabled: true, intervalSeconds: 600 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new BazarrPlugin();
    client = createContractHttpClient('bazarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Bazarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects wanted subtitles and history data from Bazarr');
    });
  });

  describe('health', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/system/health');
    });

    it('should pass the health check against the contract route', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
      expect(client.get).toHaveBeenCalledWith('/api/system/health', expect.anything());
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(client.defaults.headers.common['X-API-KEY']).toBe('bazarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Bazarr_1_wanted', 300],
        ['Bazarr_1_history', 600],
      ]);
    });

    it('should only return wanted schedule when history is disabled', async () => {
      await plugin.initialize({ ...testConfig, history: { ...testConfig.history, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Bazarr_1_wanted']);
    });

    it('should only return history schedule when wanted is disabled', async () => {
      await plugin.initialize({ ...testConfig, wanted: { ...testConfig.wanted, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Bazarr_1_history']);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should request each endpoint with its page length', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/api/movies/wanted', { params: { length: 1000 } });
      expect(client.get).toHaveBeenCalledWith('/api/episodes/wanted', { params: { length: 1000 } });
      expect(client.get).toHaveBeenCalledWith('/api/movies/history', { params: { length: 100 } });
      expect(client.get).toHaveBeenCalledWith('/api/episodes/history', { params: { length: 100 } });
    });

    it('should collect wanted movie subtitles', async () => {
      const points = ofKind(await plugin.collect(), 'Wanted', 'movie');

      expect(points.map((p) => p.tags.name)).toEqual(['Heat - English', 'Heat - French', 'Arrival - English']);
      expect(points[1].tags).toMatchObject({ radarrId: 1, title: 'Heat', languageCode: 'fra', forced: 0, hi: 1 });
    });

    it('should collect wanted episode subtitles', async () => {
      const points = ofKind(await plugin.collect(), 'Wanted', 'episode');

      expect(points.map((p) => p.tags.name)).toEqual([
        'Severance - 1x1 - English',
        'Severance - 2x3 - English',
        'Severance - 2x3 - French',
      ]);
      expect(points[0].tags).toMatchObject({ sonarrSeriesId: 10, sonarrEpisodeId: 101, episodeNumber: '1x1' });
    });

    it('should skip wanted items without missing subtitles', async () => {
      const [heat, arrival] = wantedMovies();
      client.override('/api/movies/wanted', { data: [{ ...heat, missing_subtitles: [] }, arrival], total: 2 });

      const points = ofKind(await plugin.collect(), 'Wanted', 'movie');

      expect(points.map((p) => p.tags.name)).toEqual(['Arrival - English']);
    });

    it('should timestamp movie history from parsed_timestamp', async () => {
      const points = ofKind(await plugin.collect(), 'History', 'movie');

      expect(points).toHaveLength(3);
      expect(points[0].tags).toMatchObject({ name: 'Heat - English', provider: 'opensubtitlescom', action: 1 });
      expect(points[0].fields.score_percent).toBe(92.5);
      expect(points[0].fields.score).toBeUndefined();
      expect(points[0].timestamp).toEqual(new Date(2026, 10, 20, 14, 5, 9));
    });

    it('declares the history score as a float field', async () => {
      const [point] = ofKind(await plugin.collect(), 'History', 'movie');

      expect(point.floatFields).toEqual(['score_percent']);
    });

    it('should collect series history', async () => {
      const points = ofKind(await plugin.collect(), 'History', 'series');

      expect(points.map((p) => p.tags.name)).toEqual(['Severance - 1x1 - English', 'Severance - 2x3 - French']);
      expect(points[1].timestamp).toEqual(new Date(2026, 10, 20, 11, 0, 0));
      expect(points.map((p) => p.fields.score_percent)).toEqual([92.5, 71.25]);
    });

    it('should fall back for null history fields', async () => {
      const tenet = ofKind(await plugin.collect(), 'History', 'movie')[2];

      expect(tenet.tags).toMatchObject({
        name: 'Tenet - unknown',
        language: 'unknown',
        languageCode: 'unknown',
        provider: 'unknown',
      });
      expect(tenet.fields).not.toHaveProperty('score_percent');
      expect(tenet.fields).not.toHaveProperty('score');
    });

    it('omits an unparsable history score', async () => {
      const [heat] = movieHistory();
      client.override('/api/movies/history', { data: [{ ...heat, score: 'n/a' }], total: 1 });

      const [point] = ofKind(await plugin.collect(), 'History', 'movie');

      expect(point.fields).not.toHaveProperty('score_percent');
    });

    it('should fall back to collection time when parsed_timestamp is not parseable', async () => {
      const [heat] = movieHistory();
      client.override('/api/movies/history', { data: [{ ...heat, parsed_timestamp: '20.11.2026 14:05:09' }], total: 1 });
      const before = Date.now();

      const [point] = ofKind(await plugin.collect(), 'History', 'movie');

      expect(point.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('should give distinct hashes to distinct history events', async () => {
      const [heat] = movieHistory();
      client.override('/api/movies/history', {
        data: [heat, { ...heat, parsed_timestamp: '11/20/26 16:00:00' }],
        total: 2,
      });

      const hashes = (await plugin.collect()).filter((p) => p.tags.type === 'History').map((p) => p.fields.hash);

      expect(new Set(hashes).size).toBe(hashes.length);
    });

    it('should generate deterministic hash IDs', async () => {
      const first = (await plugin.collect()).map((p) => p.fields.hash);
      const second = (await plugin.collect()).map((p) => p.fields.hash);

      expect(second).toEqual(first);
    });

    it('should handle empty responses', async () => {
      for (const route of ROUTES) {
        client.override(route, { data: [], total: 0 });
      }

      await expect(plugin.collect()).resolves.toEqual([]);
    });

    it('should propagate wanted API errors for circuit breaker', async () => {
      client.fail('/api/movies/wanted', new Error('Wanted API Error'));

      await expect(plugin.collect()).rejects.toThrow('Wanted API Error');
    });

    it('should propagate history API errors for circuit breaker', async () => {
      client.fail('/api/movies/history', new Error('History API Error'));

      await expect(plugin.collect()).rejects.toThrow('History API Error');
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
