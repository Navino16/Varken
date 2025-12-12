import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OverseerrPlugin } from '../../../src/plugins/inputs/OverseerrPlugin';
import { OverseerrConfig } from '../../../src/types/inputs/overseerr.types';
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

describe('OverseerrPlugin', () => {
  let plugin: OverseerrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: OverseerrConfig = {
    id: 1,
    url: 'http://localhost:5055',
    apiKey: 'overseerr-api-key',
    ssl: false,
    verifySsl: false,
    requestCounts: {
      enabled: true,
      intervalSeconds: 300,
    },
    latestRequests: {
      enabled: true,
      intervalSeconds: 60,
      count: 10,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new OverseerrPlugin();

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
      expect(plugin.metadata.name).toBe('Overseerr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects request counts and latest requests from Overseerr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('overseerr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Overseerr_1_request_counts');
      expect(schedules[0].intervalSeconds).toBe(300);
      expect(schedules[1].name).toBe('Overseerr_1_latest_requests');
      expect(schedules[1].intervalSeconds).toBe(60);
    });

    it('should only return request_counts schedule when latestRequests is disabled', async () => {
      const configWithoutLatest = {
        ...testConfig,
        latestRequests: { ...testConfig.latestRequests, enabled: false },
      };
      await plugin.initialize(configWithoutLatest);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Overseerr_1_request_counts');
    });

    it('should only return latest_requests schedule when requestCounts is disabled', async () => {
      const configWithoutCounts = {
        ...testConfig,
        requestCounts: { ...testConfig.requestCounts, enabled: false },
      };
      await plugin.initialize(configWithoutCounts);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Overseerr_1_latest_requests');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect request counts', async () => {
      // Mock request counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          pending: 5,
          approved: 10,
          processing: 2,
          available: 50,
          total: 67,
          movie: 30,
          tv: 37,
          declined: 3,
        },
      });

      // Mock issue counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          total: 10,
          video: 3,
          audio: 2,
          subtitles: 4,
          others: 1,
          open: 6,
          closed: 4,
        },
      });

      // Mock latest requests (empty for this test)
      mockHttpClient.get.mockResolvedValueOnce({
        data: { results: [] },
      });

      const points = await plugin.collect();

      const requestCountsPoint = points.find((p) => p.tags.type === 'Request_Counts');
      expect(requestCountsPoint).toBeDefined();
      expect(requestCountsPoint?.fields.pending).toBe(5);
      expect(requestCountsPoint?.fields.approved).toBe(10);
      expect(requestCountsPoint?.fields.processing).toBe(2);
      expect(requestCountsPoint?.fields.available).toBe(50);
      expect(requestCountsPoint?.fields.total).toBe(67);
      expect(requestCountsPoint?.fields.movies).toBe(30);
      expect(requestCountsPoint?.fields.tv).toBe(37);
      expect(requestCountsPoint?.fields.declined).toBe(3);
    });

    it('should collect issue counts', async () => {
      // Mock request counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          pending: 0,
          approved: 0,
          processing: 0,
          available: 0,
          total: 0,
          movie: 0,
          tv: 0,
          declined: 0,
        },
      });

      // Mock issue counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          total: 15,
          video: 5,
          audio: 3,
          subtitles: 6,
          others: 1,
          open: 10,
          closed: 5,
        },
      });

      // Mock latest requests (empty)
      mockHttpClient.get.mockResolvedValueOnce({
        data: { results: [] },
      });

      const points = await plugin.collect();

      const issuesPoint = points.find((p) => p.tags.type === 'Issues_Counts');
      expect(issuesPoint).toBeDefined();
      expect(issuesPoint?.fields.total).toBe(15);
      expect(issuesPoint?.fields.video).toBe(5);
      expect(issuesPoint?.fields.audio).toBe(3);
      expect(issuesPoint?.fields.subtitles).toBe(6);
      expect(issuesPoint?.fields.others).toBe(1);
      expect(issuesPoint?.fields.open).toBe(10);
      expect(issuesPoint?.fields.closed).toBe(5);
    });

    it('should collect latest movie requests', async () => {
      // Mock request counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });

      // Mock issue counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });

      // Mock latest requests
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              id: 1,
              type: 'movie',
              media: { tmdbId: 12345 },
            },
          ],
        },
      });

      // Mock movie details
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 12345,
          title: 'Inception',
          mediaInfo: {
            status: 5,
            requests: [
              {
                requestedBy: { displayName: 'John Doe' },
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
          },
        },
      });

      const points = await plugin.collect();

      const requestPoint = points.find((p) => p.tags.type === 'Requests');
      expect(requestPoint).toBeDefined();
      expect(requestPoint?.tags.title).toBe('Inception');
      expect(requestPoint?.tags.request_type).toBe(1); // Movie = 1
      expect(requestPoint?.tags.requested_user).toBe('John Doe');
      expect(requestPoint?.tags.status).toBe(5);
    });

    it('should collect latest TV requests', async () => {
      // Mock request counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });

      // Mock issue counts
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });

      // Mock latest requests
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              id: 2,
              type: 'tv',
              media: { tmdbId: 67890 },
            },
          ],
        },
      });

      // Mock TV show details
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 67890,
          name: 'Breaking Bad',
          mediaInfo: {
            status: 3,
            requests: [
              {
                requestedBy: { displayName: 'Jane Smith' },
                createdAt: '2024-01-10T15:30:00Z',
              },
            ],
          },
        },
      });

      const points = await plugin.collect();

      const requestPoint = points.find((p) => p.tags.type === 'Requests');
      expect(requestPoint).toBeDefined();
      expect(requestPoint?.tags.title).toBe('Breaking Bad');
      expect(requestPoint?.tags.request_type).toBe(0); // TV = 0
      expect(requestPoint?.tags.requested_user).toBe('Jane Smith');
    });

    it('should skip requests without media tmdbId', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              id: 1,
              type: 'movie',
              media: { tmdbId: null }, // No tmdbId
            },
            {
              id: 2,
              type: 'movie',
              media: { tmdbId: 12345 },
            },
          ],
        },
      });

      // Only one valid request should fetch details
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 12345,
          title: 'Valid Movie',
          mediaInfo: {
            status: 5,
            requests: [{ requestedBy: { displayName: 'User' }, createdAt: '2024-01-01' }],
          },
        },
      });

      const points = await plugin.collect();

      const requestPoints = points.filter((p) => p.tags.type === 'Requests');
      expect(requestPoints.length).toBe(1);
      expect(requestPoints[0].tags.title).toBe('Valid Movie');
    });

    it('should handle empty results gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { results: [] },
      });

      const points = await plugin.collect();

      // Should still have request counts and issue counts
      expect(points.find((p) => p.tags.type === 'Request_Counts')).toBeDefined();
      expect(points.find((p) => p.tags.type === 'Issues_Counts')).toBeDefined();
      expect(points.filter((p) => p.tags.type === 'Requests').length).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('Request counts API error'));
      mockHttpClient.get.mockRejectedValueOnce(new Error('Issue counts API error'));
      mockHttpClient.get.mockRejectedValueOnce(new Error('Latest requests API error'));

      const points = await plugin.collect();
      expect(points).toBeDefined();
      expect(points.length).toBe(0);
    });

    it('should handle media details fetch failure gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          results: [
            { id: 1, type: 'movie', media: { tmdbId: 12345 } },
          ],
        },
      });

      // Movie details fetch fails
      mockHttpClient.get.mockRejectedValueOnce(new Error('Movie details error'));

      const points = await plugin.collect();

      // Should have counts but no request details
      expect(points.find((p) => p.tags.type === 'Request_Counts')).toBeDefined();
      expect(points.find((p) => p.tags.type === 'Issues_Counts')).toBeDefined();
      expect(points.filter((p) => p.tags.type === 'Requests').length).toBe(0);
    });

    it('should generate deterministic hash IDs', async () => {
      const setupMocks = () => {
        mockHttpClient.get.mockResolvedValueOnce({
          data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
        });
        mockHttpClient.get.mockResolvedValueOnce({
          data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
        });
        mockHttpClient.get.mockResolvedValueOnce({
          data: {
            results: [{ id: 1, type: 'movie', media: { tmdbId: 12345 } }],
          },
        });
        mockHttpClient.get.mockResolvedValueOnce({
          data: {
            id: 12345,
            title: 'Test Movie',
            mediaInfo: {
              status: 5,
              requests: [{ requestedBy: { displayName: 'User' }, createdAt: '2024-01-01' }],
            },
          },
        });
      };

      setupMocks();
      const points1 = await plugin.collect();

      setupMocks();
      const points2 = await plugin.collect();

      const request1 = points1.find((p) => p.tags.type === 'Requests');
      const request2 = points2.find((p) => p.tags.type === 'Requests');

      expect(request1?.fields.hash).toBe(request2?.fields.hash);
    });

    it('should handle missing requestedBy information', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { pending: 0, approved: 0, processing: 0, available: 0, total: 0, movie: 0, tv: 0, declined: 0 },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { total: 0, video: 0, audio: 0, subtitles: 0, others: 0, open: 0, closed: 0 },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          results: [{ id: 1, type: 'movie', media: { tmdbId: 12345 } }],
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 12345,
          title: 'Test Movie',
          mediaInfo: {
            status: 5,
            requests: [{ createdAt: '2024-01-01' }], // No requestedBy
          },
        },
      });

      const points = await plugin.collect();

      const requestPoint = points.find((p) => p.tags.type === 'Requests');
      expect(requestPoint?.tags.requested_user).toBe('Unknown');
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
