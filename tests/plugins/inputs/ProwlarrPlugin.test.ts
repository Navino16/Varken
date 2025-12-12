import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ProwlarrPlugin } from '../../../src/plugins/inputs/ProwlarrPlugin';
import { ProwlarrConfig } from '../../../src/types/inputs/prowlarr.types';
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

describe('ProwlarrPlugin', () => {
  let plugin: ProwlarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: ProwlarrConfig = {
    id: 1,
    url: 'http://localhost:9696',
    apiKey: 'prowlarr-api-key',
    verifySsl: false,
    indexerStats: {
      enabled: true,
      intervalSeconds: 300,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new ProwlarrPlugin();

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
      expect(plugin.metadata.name).toBe('Prowlarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects indexer statistics from Prowlarr');
    });
  });

  describe('getHealthEndpoint', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/v1/system/status');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('prowlarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Prowlarr_1_indexerStats');
      expect(schedules[0].intervalSeconds).toBe(300);
    });

    it('should return empty schedules when indexerStats is disabled', async () => {
      const configDisabled = {
        ...testConfig,
        indexerStats: { ...testConfig.indexerStats, enabled: false },
      };
      await plugin.initialize(configDisabled);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(0);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect indexer stats', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            indexerId: 1,
            indexerName: 'NZBgeek',
            averageResponseTime: 150,
            numberOfQueries: 100,
            numberOfGrabs: 50,
            numberOfRssQueries: 20,
            numberOfAuthQueries: 5,
            numberOfFailedQueries: 2,
            numberOfFailedGrabs: 1,
            numberOfFailedRssQueries: 0,
            numberOfFailedAuthQueries: 0,
          },
          {
            indexerId: 2,
            indexerName: '1337x',
            averageResponseTime: 200,
            numberOfQueries: 80,
            numberOfGrabs: 30,
            numberOfRssQueries: 10,
            numberOfAuthQueries: 0,
            numberOfFailedQueries: 5,
            numberOfFailedGrabs: 2,
            numberOfFailedRssQueries: 1,
            numberOfFailedAuthQueries: 0,
          },
        ],
      });

      const points = await plugin.collect();

      expect(points.length).toBe(2);

      const nzbgeek = points.find((p) => p.tags.indexerName === 'NZBgeek');
      expect(nzbgeek).toBeDefined();
      expect(nzbgeek?.tags.type).toBe('IndexerStats');
      expect(nzbgeek?.tags.indexerId).toBe(1);
      expect(nzbgeek?.fields.averageResponseTime).toBe(150);
      expect(nzbgeek?.fields.numberOfQueries).toBe(100);
      expect(nzbgeek?.fields.numberOfGrabs).toBe(50);

      const torrent = points.find((p) => p.tags.indexerName === '1337x');
      expect(torrent).toBeDefined();
      expect(torrent?.fields.numberOfFailedQueries).toBe(5);
    });

    it('should include all stats fields', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            indexerId: 1,
            indexerName: 'TestIndexer',
            averageResponseTime: 100,
            numberOfQueries: 50,
            numberOfGrabs: 25,
            numberOfRssQueries: 10,
            numberOfAuthQueries: 5,
            numberOfFailedQueries: 3,
            numberOfFailedGrabs: 2,
            numberOfFailedRssQueries: 1,
            numberOfFailedAuthQueries: 0,
          },
        ],
      });

      const points = await plugin.collect();

      expect(points[0].fields.averageResponseTime).toBe(100);
      expect(points[0].fields.numberOfQueries).toBe(50);
      expect(points[0].fields.numberOfGrabs).toBe(25);
      expect(points[0].fields.numberOfRssQueries).toBe(10);
      expect(points[0].fields.numberOfAuthQueries).toBe(5);
      expect(points[0].fields.numberOfFailedQueries).toBe(3);
      expect(points[0].fields.numberOfFailedGrabs).toBe(2);
      expect(points[0].fields.numberOfFailedRssQueries).toBe(1);
      expect(points[0].fields.numberOfFailedAuthQueries).toBe(0);
    });

    it('should handle empty indexer stats', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle null response', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: null });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));

      const points = await plugin.collect();
      expect(points).toBeDefined();
      expect(points).toEqual([]);
    });

    it('should generate deterministic hash IDs', async () => {
      const indexerData = {
        indexerId: 1,
        indexerName: 'TestIndexer',
        averageResponseTime: 100,
        numberOfQueries: 50,
        numberOfGrabs: 25,
        numberOfRssQueries: 10,
        numberOfAuthQueries: 5,
        numberOfFailedQueries: 3,
        numberOfFailedGrabs: 2,
        numberOfFailedRssQueries: 1,
        numberOfFailedAuthQueries: 0,
      };

      mockHttpClient.get.mockResolvedValueOnce({ data: [indexerData] });
      const points1 = await plugin.collect();

      mockHttpClient.get.mockResolvedValueOnce({ data: [indexerData] });
      const points2 = await plugin.collect();

      expect(points1[0].fields.hash).toBe(points2[0].fields.hash);
    });

    it('should not collect when indexerStats is disabled', async () => {
      const configDisabled = {
        ...testConfig,
        indexerStats: { ...testConfig.indexerStats, enabled: false },
      };

      // Re-initialize with disabled config
      plugin = new ProwlarrPlugin();
      (axios.create as Mock).mockReturnValue(mockHttpClient);
      await plugin.initialize(configDisabled);

      const points = await plugin.collect();
      expect(points).toEqual([]);
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
