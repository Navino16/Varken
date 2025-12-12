import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { LidarrPlugin } from '../../../src/plugins/inputs/LidarrPlugin';
import { LidarrConfig } from '../../../src/types/inputs/lidarr.types';
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

describe('LidarrPlugin', () => {
  let plugin: LidarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: LidarrConfig = {
    id: 1,
    url: 'http://localhost:8686',
    apiKey: 'lidarr-api-key',
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
    plugin = new LidarrPlugin();

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
      expect(plugin.metadata.name).toBe('Lidarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing albums data from Lidarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('lidarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Lidarr_1_queue');
      expect(schedules[0].intervalSeconds).toBe(30);
      expect(schedules[1].name).toBe('Lidarr_1_missing');
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
      expect(schedules[0].name).toBe('Lidarr_1_queue');
    });

    it('should only return missing schedule when queue is disabled', async () => {
      const configWithoutQueue = {
        ...testConfig,
        queue: { ...testConfig.queue, enabled: false },
      };
      await plugin.initialize(configWithoutQueue);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Lidarr_1_missing');
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
              albumId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'FLAC' } },
              album: {
                title: 'Abbey Road',
              },
              artist: {
                artistName: 'The Beatles',
              },
            },
          ],
        },
      });

      // Mock empty missing albums
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();

      expect(points.length).toBeGreaterThan(0);
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint).toBeDefined();
      expect(queuePoint?.tags.name).toBe('Abbey Road - The Beatles');
      expect(queuePoint?.tags.protocol).toBe('USENET');
      expect(queuePoint?.tags.quality).toBe('FLAC');
    });

    it('should set protocol_id correctly for usenet', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              albumId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'FLAC' } },
              album: { title: 'Test Album' },
              artist: { artistName: 'Test Artist' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

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
              albumId: 100,
              protocol: 'torrent',
              quality: { quality: { name: 'MP3-320' } },
              album: { title: 'Test Album' },
              artist: { artistName: 'Test Artist' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.protocol_id).toBe(0);
    });

    it('should handle missing artist name', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              albumId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'FLAC' } },
              album: { title: 'Unknown Album' },
              artist: null,
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.name).toBe('Unknown Album - Unknown Artist');
    });

    it('should collect missing albums', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      // Mock missing albums
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          records: [
            {
              id: 1,
              foreignAlbumId: 'abc123',
              title: 'Let It Be',
              artist: {
                artistName: 'The Beatles',
              },
            },
            {
              id: 2,
              foreignAlbumId: 'def456',
              title: 'Revolver',
              artist: {
                artistName: 'The Beatles',
              },
            },
          ],
        },
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(2);

      const letItBe = missingPoints.find((p) => p.tags.name === 'Let It Be - The Beatles');
      expect(letItBe).toBeDefined();
      expect(letItBe?.tags.foreignAlbumId).toBe('abc123');

      const revolver = missingPoints.find((p) => p.tags.name === 'Revolver - The Beatles');
      expect(revolver).toBeDefined();
    });

    it('should handle missing artist in missing albums', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          records: [
            {
              id: 1,
              foreignAlbumId: 'xyz789',
              title: 'Mystery Album',
              artist: null,
            },
          ],
        },
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(1);
      expect(missingPoints[0].tags.name).toBe('Mystery Album - Unknown Artist');
    });

    it('should handle empty queue gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });

    it('should skip queue items without album data', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 2,
          records: [
            {
              id: 1,
              albumId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'FLAC' } },
              album: null,
              artist: { artistName: 'Artist' },
            },
            {
              id: 2,
              albumId: 101,
              protocol: 'usenet',
              quality: { quality: { name: 'FLAC' } },
              album: { title: 'Valid Album' },
              artist: { artistName: 'Valid Artist' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(1);
      expect(queuePoints[0].tags.name).toBe('Valid Album - Valid Artist');
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
              albumId: 100,
              protocol: 'torrent',
              quality: { quality: { name: 'FLAC' } },
              album: { title: 'Album 1' },
              artist: { artistName: 'Artist 1' },
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
              albumId: 101,
              protocol: 'usenet',
              quality: { quality: { name: 'MP3-320' } },
              album: { title: 'Album 2' },
              artist: { artistName: 'Artist 2' },
            },
          ],
        },
      });

      // Missing albums mock
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(2);
    });

    it('should generate deterministic hash IDs', async () => {
      const albumData = {
        id: 1,
        albumId: 100,
        protocol: 'usenet',
        quality: { quality: { name: 'FLAC' } },
        album: { title: 'Test Album' },
        artist: { artistName: 'Test Artist' },
      };

      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [albumData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

      const points1 = await plugin.collect();

      // Collect again with same data
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [albumData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: { records: [] } });

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
