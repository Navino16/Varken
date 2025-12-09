import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { RadarrPlugin } from '../../../src/plugins/inputs/RadarrPlugin';
import { RadarrConfig } from '../../../src/types/inputs/radarr.types';
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

describe('RadarrPlugin', () => {
  let plugin: RadarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: RadarrConfig = {
    id: 1,
    url: 'http://localhost:7878',
    apiKey: 'radarr-api-key',
    ssl: false,
    verifySsl: false,
    queue: {
      enabled: true,
      intervalSeconds: 30,
    },
    missing: {
      enabled: true,
      intervalSeconds: 300,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new RadarrPlugin();

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
      expect(plugin.metadata.name).toBe('Radarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing movies data from Radarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('radarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Radarr_1_queue');
      expect(schedules[0].intervalSeconds).toBe(30);
      expect(schedules[1].name).toBe('Radarr_1_missing');
      expect(schedules[1].intervalSeconds).toBe(300);
    });

    it('should only return queue schedule when missing is disabled', async () => {
      const configWithoutMissing = {
        ...testConfig,
        missing: { ...testConfig.missing, enabled: false },
      };
      await plugin.initialize(configWithoutMissing);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Radarr_1_queue');
    });

    it('should only return missing schedule when queue is disabled', async () => {
      const configWithoutQueue = {
        ...testConfig,
        queue: { ...testConfig.queue, enabled: false },
      };
      await plugin.initialize(configWithoutQueue);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Radarr_1_missing');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect queue data', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 1,
          pageSize: 250,
          totalRecords: 1,
          records: [
            {
              id: 1,
              movieId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'Bluray-1080p' } },
              movie: {
                title: 'The Matrix',
                year: 1999,
                titleSlug: 'the-matrix-1999',
              },
            },
          ],
        },
      });

      // Mock empty missing movies
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      expect(points.length).toBeGreaterThan(0);
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint).toBeDefined();
      expect(queuePoint?.tags.name).toBe('The Matrix (1999)');
      expect(queuePoint?.tags.protocol).toBe('USENET');
      expect(queuePoint?.tags.quality).toBe('Bluray-1080p');
      expect(queuePoint?.tags.titleSlug).toBe('the-matrix-1999');
    });

    it('should set protocol_id correctly for usenet', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              movie: { title: 'Test', year: 2024, titleSlug: 'test' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.protocol_id).toBe(1);
    });

    it('should set protocol_id correctly for torrent', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              protocol: 'torrent',
              quality: { quality: { name: 'HDTV-1080p' } },
              movie: { title: 'Test', year: 2024, titleSlug: 'test' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.protocol_id).toBe(0);
    });

    it('should collect missing movies', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      // Mock missing movies
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            tmdbId: 12345,
            title: 'Dune: Part Two',
            year: 2024,
            titleSlug: 'dune-part-two-2024',
            monitored: true,
            hasFile: false,
            isAvailable: true,
          },
          {
            tmdbId: 67890,
            title: 'Future Movie',
            year: 2025,
            titleSlug: 'future-movie-2025',
            monitored: true,
            hasFile: false,
            isAvailable: false,
          },
        ],
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(2);

      const dunePoint = missingPoints.find((p) => p.tags.name === 'Dune: Part Two (2024)');
      expect(dunePoint).toBeDefined();
      expect(dunePoint?.tags.Missing_Available).toBe(0); // Available = 0

      const futurePoint = missingPoints.find((p) => p.tags.name === 'Future Movie (2025)');
      expect(futurePoint).toBeDefined();
      expect(futurePoint?.tags.Missing_Available).toBe(1); // Not available = 1
    });

    it('should skip movies that have files', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            tmdbId: 12345,
            title: 'Downloaded Movie',
            year: 2023,
            titleSlug: 'downloaded-movie',
            monitored: true,
            hasFile: true,
            isAvailable: true,
          },
        ],
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(0);
    });

    it('should skip unmonitored movies', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            tmdbId: 12345,
            title: 'Unmonitored Movie',
            year: 2023,
            titleSlug: 'unmonitored-movie',
            monitored: false,
            hasFile: false,
            isAvailable: true,
          },
        ],
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(0);
    });

    it('should handle empty queue gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });

    it('should skip queue items without movie data', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 2,
          records: [
            {
              id: 1,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              movie: null, // Missing movie data
            },
            {
              id: 2,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              movie: { title: 'Valid Movie', year: 2024, titleSlug: 'valid-movie' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(1);
      expect(queuePoints[0].tags.name).toBe('Valid Movie (2024)');
    });

    it('should paginate through large queues', async () => {
      // First page
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 1,
          pageSize: 250,
          totalRecords: 2,
          records: [
            {
              id: 1,
              protocol: 'torrent',
              quality: { quality: { name: 'WEBDL-1080p' } },
              movie: { title: 'Movie 1', year: 2024, titleSlug: 'movie-1' },
            },
          ],
        },
      });

      // Second page
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 2,
          pageSize: 250,
          totalRecords: 2,
          records: [
            {
              id: 2,
              protocol: 'usenet',
              quality: { quality: { name: 'Bluray-1080p' } },
              movie: { title: 'Movie 2', year: 2023, titleSlug: 'movie-2' },
            },
          ],
        },
      });

      // Missing movies mock
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(2);
    });

    it('should generate deterministic hash IDs', async () => {
      const movieData = {
        id: 1,
        protocol: 'usenet',
        quality: { quality: { name: 'HDTV-1080p' } },
        movie: { title: 'Test Movie', year: 2024, titleSlug: 'test-movie' },
      };

      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [movieData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points1 = await plugin.collect();

      // Collect again with same data
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [movieData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points2 = await plugin.collect();

      expect(points1[0].fields.hash).toBe(points2[0].fields.hash);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
