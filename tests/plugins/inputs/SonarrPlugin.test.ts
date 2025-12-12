import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { SonarrPlugin } from '../../../src/plugins/inputs/SonarrPlugin';
import { SonarrConfig } from '../../../src/types/inputs/sonarr.types';
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

describe('SonarrPlugin', () => {
  let plugin: SonarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: SonarrConfig = {
    id: 1,
    url: 'http://localhost:8989',
    apiKey: 'test-api-key',
    ssl: false,
    verifySsl: false,
    queue: {
      enabled: true,
      intervalSeconds: 30,
    },
    calendar: {
      enabled: true,
      intervalSeconds: 60,
      missingDays: 7,
      futureDays: 7,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new SonarrPlugin();

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
      expect(plugin.metadata.name).toBe('Sonarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and calendar data from Sonarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      // Should have queue, calendar_missing, and calendar_future schedules
      expect(schedules.length).toBe(3);
      expect(schedules[0].name).toBe('Sonarr_1_queue');
      expect(schedules[0].intervalSeconds).toBe(30);
      expect(schedules[1].name).toBe('Sonarr_1_calendar_missing');
      expect(schedules[1].intervalSeconds).toBe(60);
      expect(schedules[2].name).toBe('Sonarr_1_calendar_future');
      expect(schedules[2].intervalSeconds).toBe(60);
    });

    it('should only return queue schedule when calendar is disabled', async () => {
      const configWithoutCalendar = {
        ...testConfig,
        calendar: { ...testConfig.calendar, enabled: false },
      };
      await plugin.initialize(configWithoutCalendar);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Sonarr_1_queue');
    });

    it('should only return calendar schedules when queue is disabled', async () => {
      const configWithoutQueue = {
        ...testConfig,
        queue: { ...testConfig.queue, enabled: false },
      };
      await plugin.initialize(configWithoutQueue);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Sonarr_1_calendar_missing');
      expect(schedules[1].name).toBe('Sonarr_1_calendar_future');
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
              seriesId: 100,
              episodeId: 200,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              series: { title: 'Breaking Bad' },
              episode: {
                title: 'Pilot',
                seasonNumber: 1,
                episodeNumber: 1,
              },
            },
          ],
        },
      });

      // Mock empty responses for calendar queries
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      expect(points.length).toBeGreaterThan(0);
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint).toBeDefined();
      expect(queuePoint?.tags.name).toBe('Breaking Bad');
      expect(queuePoint?.tags.sxe).toBe('S01E01');
      expect(queuePoint?.tags.protocol).toBe('USENET');
      expect(queuePoint?.tags.quality).toBe('HDTV-1080p');
    });

    it('should collect missing episodes from calendar', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { page: 1, pageSize: 250, totalRecords: 0, records: [] },
      });

      // Mock missing episodes
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            seriesId: 100,
            title: 'Missing Episode',
            seasonNumber: 2,
            episodeNumber: 5,
            hasFile: false,
            monitored: true,
            airDateUtc: '2024-01-15T20:00:00Z',
            series: { title: 'Game of Thrones' },
          },
        ],
      });

      // Mock future episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const missingPoint = points.find((p) => p.tags.type === 'Missing');
      expect(missingPoint).toBeDefined();
      expect(missingPoint?.tags.name).toBe('Game of Thrones');
      expect(missingPoint?.tags.sxe).toBe('S02E05');
      expect(missingPoint?.tags.downloaded).toBe(0);
    });

    it('should skip missing episodes that have files', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { page: 1, pageSize: 250, totalRecords: 0, records: [] },
      });

      // Mock episodes with hasFile: true (should be skipped)
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            seriesId: 100,
            title: 'Already Downloaded',
            seasonNumber: 1,
            episodeNumber: 1,
            hasFile: true,
            monitored: true,
            series: { title: 'The Office' },
          },
        ],
      });

      // Mock future episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(0);
    });

    it('should collect future episodes from calendar', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { page: 1, pageSize: 250, totalRecords: 0, records: [] },
      });

      // Mock missing episodes (empty)
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      // Mock future episodes
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            seriesId: 100,
            title: 'Future Episode',
            seasonNumber: 3,
            episodeNumber: 10,
            hasFile: false,
            monitored: true,
            airDateUtc: '2025-06-15T20:00:00Z',
            series: { title: 'Stranger Things' },
          },
        ],
      });

      const points = await plugin.collect();

      const futurePoint = points.find((p) => p.tags.type === 'Future');
      expect(futurePoint).toBeDefined();
      expect(futurePoint?.tags.name).toBe('Stranger Things');
      expect(futurePoint?.tags.sxe).toBe('S03E10');
    });

    it('should handle empty queue gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { page: 1, pageSize: 250, totalRecords: 0, records: [] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toBeDefined();
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
              seriesId: 100,
              protocol: 'torrent',
              quality: { quality: { name: 'WEBDL-1080p' } },
              series: { title: 'Show 1' },
              episode: { title: 'Ep 1', seasonNumber: 1, episodeNumber: 1 },
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
              seriesId: 101,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-720p' } },
              series: { title: 'Show 2' },
              episode: { title: 'Ep 1', seasonNumber: 1, episodeNumber: 1 },
            },
          ],
        },
      });

      // Calendar mocks
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(2);
    });

    it('should generate deterministic hash IDs', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              seriesId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              series: { title: 'Test Show' },
              episode: { title: 'Test Episode', seasonNumber: 1, episodeNumber: 1 },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points1 = await plugin.collect();

      // Reset and collect again
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              seriesId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'HDTV-1080p' } },
              series: { title: 'Test Show' },
              episode: { title: 'Test Episode', seasonNumber: 1, episodeNumber: 1 },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points2 = await plugin.collect();

      // Hash should be the same for identical data
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
