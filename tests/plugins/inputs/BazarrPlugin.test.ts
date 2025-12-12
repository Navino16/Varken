import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { BazarrPlugin } from '../../../src/plugins/inputs/BazarrPlugin';
import { BazarrConfig } from '../../../src/types/inputs/bazarr.types';
import axios from 'axios';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    })),
  },
}));

describe('BazarrPlugin', () => {
  let plugin: BazarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: BazarrConfig = {
    id: 1,
    url: 'http://localhost:6767',
    apiKey: 'bazarr-api-key',
    verifySsl: false,
    wanted: {
      enabled: true,
      intervalSeconds: 300,
    },
    history: {
      enabled: true,
      intervalSeconds: 600,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new BazarrPlugin();

    mockHttpClient = {
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    };
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Bazarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects wanted subtitles and history data from Bazarr');
    });
  });

  describe('getHealthEndpoint', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/system/health');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-API-KEY']).toBe('bazarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Bazarr_1_wanted');
      expect(schedules[0].intervalSeconds).toBe(300);
      expect(schedules[1].name).toBe('Bazarr_1_history');
      expect(schedules[1].intervalSeconds).toBe(600);
    });

    it('should only return wanted schedule when history is disabled', async () => {
      const configWithoutHistory = {
        ...testConfig,
        history: { ...testConfig.history, enabled: false },
      };
      await plugin.initialize(configWithoutHistory);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Bazarr_1_wanted');
    });

    it('should only return history schedule when wanted is disabled', async () => {
      const configWithoutWanted = {
        ...testConfig,
        wanted: { ...testConfig.wanted, enabled: false },
      };
      await plugin.initialize(configWithoutWanted);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Bazarr_1_history');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect wanted movie subtitles', async () => {
      // Mock wanted movies
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              radarrId: 100,
              title: 'Test Movie',
              monitored: true,
              missing_subtitles: [
                { name: 'French', code2: 'fr', code3: 'fre', forced: false, hi: false },
                { name: 'English', code2: 'en', code3: 'eng', forced: false, hi: true },
              ],
            },
          ],
          total: 1,
        },
      });
      // Mock wanted episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock movie history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock series history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();

      const wantedPoints = points.filter((p) => p.tags.type === 'Wanted');
      expect(wantedPoints.length).toBe(2);

      const frenchSubtitle = wantedPoints.find((p) => p.tags.languageCode === 'fre');
      expect(frenchSubtitle).toBeDefined();
      expect(frenchSubtitle?.tags.title).toBe('Test Movie');
      expect(frenchSubtitle?.tags.mediaType).toBe('movie');
      expect(frenchSubtitle?.tags.forced).toBe(0);
      expect(frenchSubtitle?.tags.hi).toBe(0);

      const englishSubtitle = wantedPoints.find((p) => p.tags.languageCode === 'eng');
      expect(englishSubtitle).toBeDefined();
      expect(englishSubtitle?.tags.hi).toBe(1);
    });

    it('should collect wanted episode subtitles', async () => {
      // Mock wanted movies (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock wanted episodes
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              sonarrSeriesId: 50,
              sonarrEpisodeId: 500,
              seriesTitle: 'Test Series',
              episode_number: 'S01E05',
              monitored: true,
              missing_subtitles: [
                { name: 'Spanish', code2: 'es', code3: 'spa', forced: true, hi: false },
              ],
            },
          ],
          total: 1,
        },
      });
      // Mock movie history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock series history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();

      const wantedPoints = points.filter((p) => p.tags.type === 'Wanted');
      expect(wantedPoints.length).toBe(1);
      expect(wantedPoints[0].tags.mediaType).toBe('episode');
      expect(wantedPoints[0].tags.seriesTitle).toBe('Test Series');
      expect(wantedPoints[0].tags.episodeNumber).toBe('S01E05');
      expect(wantedPoints[0].tags.forced).toBe(1);
    });

    it('should collect movie history', async () => {
      // Mock wanted movies (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock wanted episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock movie history
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 1,
              radarrId: 100,
              title: 'Test Movie',
              language: { name: 'French', code2: 'fr', code3: 'fre' },
              provider: 'opensubtitles',
              score: '85',
              description: 'Downloaded',
              timestamp: '2024-01-15 10:00:00',
              action: 1,
              raw_timestamp: 1705312800,
            },
          ],
          total: 1,
        },
      });
      // Mock series history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();

      const historyPoints = points.filter((p) => p.tags.type === 'History');
      expect(historyPoints.length).toBe(1);
      expect(historyPoints[0].tags.mediaType).toBe('movie');
      expect(historyPoints[0].tags.title).toBe('Test Movie');
      expect(historyPoints[0].tags.provider).toBe('opensubtitles');
      expect(historyPoints[0].fields.score).toBe('85');
    });

    it('should collect series history', async () => {
      // Mock wanted movies (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock wanted episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock movie history (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock series history
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 2,
              sonarrSeriesId: 50,
              sonarrEpisodeId: 500,
              seriesTitle: 'Test Series',
              episode_number: 'S01E05',
              language: { name: 'English', code2: 'en', code3: 'eng' },
              provider: 'subscene',
              description: 'Downloaded',
              timestamp: '2024-01-15 11:00:00',
              action: 1,
              raw_timestamp: 1705316400,
            },
          ],
          total: 1,
        },
      });

      const points = await plugin.collect();

      const historyPoints = points.filter((p) => p.tags.type === 'History');
      expect(historyPoints.length).toBe(1);
      expect(historyPoints[0].tags.mediaType).toBe('series');
      expect(historyPoints[0].tags.seriesTitle).toBe('Test Series');
      expect(historyPoints[0].tags.episodeNumber).toBe('S01E05');
    });

    it('should handle missing score in history', async () => {
      // Mock wanted (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // Mock movie history with no score
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 1,
              radarrId: 100,
              title: 'Test Movie',
              language: { name: 'French', code2: 'fr', code3: 'fre' },
              provider: 'opensubtitles',
              description: 'Downloaded',
              timestamp: '2024-01-15 10:00:00',
              action: 1,
              raw_timestamp: 1705312800,
            },
          ],
          total: 1,
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();

      expect(points[0].fields.score).toBe('');
    });

    it('should handle empty wanted responses', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle wanted API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('Wanted API Error'));
      // History calls
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });

    it('should handle history API errors gracefully', async () => {
      // Wanted calls
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      // History error
      mockHttpClient.get.mockRejectedValueOnce(new Error('History API Error'));

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });

    it('should generate deterministic hash IDs', async () => {
      const movieData = {
        radarrId: 100,
        title: 'Test Movie',
        monitored: true,
        missing_subtitles: [
          { name: 'French', code2: 'fr', code3: 'fre', forced: false, hi: false },
        ],
      };

      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [movieData], total: 1 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points1 = await plugin.collect();

      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [movieData], total: 1 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points2 = await plugin.collect();

      expect(points1[0].fields.hash).toBe(points2[0].fields.hash);
    });

    it('should use timestamp from history items', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 1,
              radarrId: 100,
              title: 'Test Movie',
              language: { name: 'French', code2: 'fr', code3: 'fre' },
              provider: 'opensubtitles',
              description: 'Downloaded',
              timestamp: '2024-01-15 10:00:00',
              action: 1,
              raw_timestamp: 1705312800,
            },
          ],
          total: 1,
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

      const points = await plugin.collect();

      // raw_timestamp 1705312800 = Mon Jan 15 2024 10:00:00 GMT+0000
      expect(points[0].timestamp.getTime()).toBe(1705312800 * 1000);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
