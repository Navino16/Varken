import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OmbiPlugin } from '../../../src/plugins/inputs/OmbiPlugin';
import {
  OmbiRequestCounts,
  OmbiIssuesCounts,
  OmbiMovieRequest,
  OmbiTVRequest,
} from '../../../src/types/inputs/ombi.types';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('OmbiPlugin', () => {
  let plugin: OmbiPlugin;
  const mockConfig = {
    id: 1,
    url: 'http://localhost:3579',
    apiKey: 'test-api-key',
    verifySsl: false,
    requestCounts: {
      enabled: true,
      intervalSeconds: 300,
    },
    issueCounts: {
      enabled: true,
      intervalSeconds: 300,
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new OmbiPlugin();
    await plugin.initialize(mockConfig);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Ombi');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('should set ApiKey header on initialization', async () => {
      const newPlugin = new OmbiPlugin();
      await newPlugin.initialize(mockConfig);

      // Access internal httpClient to verify header
      const headers = (newPlugin as unknown as { httpClient: { defaults: { headers: { common: Record<string, string> } } } }).httpClient.defaults.headers.common;
      expect(headers['ApiKey']).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', () => {
      const schedules = plugin.getSchedules();

      expect(schedules).toHaveLength(2);
      expect(schedules[0].name).toBe('Ombi_1_request_counts');
      expect(schedules[0].intervalSeconds).toBe(300);
      expect(schedules[1].name).toBe('Ombi_1_issue_counts');
      expect(schedules[1].intervalSeconds).toBe(300);
    });

    it('should only return request_counts schedule when issues disabled', async () => {
      const configWithoutIssues = {
        ...mockConfig,
        issueCounts: { enabled: false, intervalSeconds: 300 },
      };
      const newPlugin = new OmbiPlugin();
      await newPlugin.initialize(configWithoutIssues);

      const schedules = newPlugin.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('Ombi_1_request_counts');
    });

    it('should return empty array when both disabled', async () => {
      const configDisabled = {
        ...mockConfig,
        requestCounts: { enabled: false, intervalSeconds: 300 },
        issueCounts: { enabled: false, intervalSeconds: 300 },
      };
      const newPlugin = new OmbiPlugin();
      await newPlugin.initialize(configDisabled);

      const schedules = newPlugin.getSchedules();
      expect(schedules).toHaveLength(0);
    });
  });

  describe('collect', () => {
    it('should collect request counts', async () => {
      const mockRequestCounts: OmbiRequestCounts = {
        pending: 5,
        approved: 10,
        available: 15,
      };

      const mockTVRequests: OmbiTVRequest[] = [];
      const mockMovieRequests: OmbiMovieRequest[] = [];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/count') return mockRequestCounts;
        if (path === '/api/v1/Request/tv') return mockTVRequests;
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestCountsPoint = points.find(p => p.tags.type === 'Request_Counts');
      expect(requestCountsPoint).toBeDefined();
      expect(requestCountsPoint?.fields.pending).toBe(5);
      expect(requestCountsPoint?.fields.approved).toBe(10);
      expect(requestCountsPoint?.fields.available).toBe(15);
    });

    it('should collect issue counts', async () => {
      const mockIssueCounts: OmbiIssuesCounts = {
        pending: 3,
        inProgress: 2,
        resolved: 10,
      };

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Issues/count') return mockIssueCounts;
        if (path === '/api/v1/Request/count') return { pending: 0, approved: 0, available: 0 };
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/movie') return [];
        return null;
      });

      const points = await plugin.collect();

      const issueCountsPoint = points.find(p => p.tags.type === 'Issues_Counts');
      expect(issueCountsPoint).toBeDefined();
      expect(issueCountsPoint?.fields.pending).toBe(3);
      expect(issueCountsPoint?.fields.in_progress).toBe(2);
      expect(issueCountsPoint?.fields.resolved).toBe(10);
    });

    it('should process movie requests correctly', async () => {
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 1,
          theMovieDbId: 123,
          title: 'Test Movie',
          overview: 'A test movie',
          status: 'Available',
          requestStatus: 'Approved',
          approved: true,
          available: true,
          requestedDate: '2024-01-15T10:00:00Z',
          requestedUserId: 'user1',
          requestedByAlias: 'TestUser',
          requestType: 1,
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/count') return { pending: 0, approved: 1, available: 1 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoint = points.find(p => p.tags.type === 'Requests' && p.tags.request_type === 1);
      expect(requestPoint).toBeDefined();
      expect(requestPoint?.tags.title).toBe('Test Movie');
      expect(requestPoint?.tags.status).toBe(2); // Completed (approved + available)
      expect(requestPoint?.tags.requested_user).toBe('TestUser');
      expect(requestPoint?.fields.hash).toBeDefined();
    });

    it('should process TV requests correctly', async () => {
      const mockTVRequests: OmbiTVRequest[] = [
        {
          id: 2,
          tvDbId: 456,
          title: 'Test Show',
          overview: 'A test show',
          status: 'Pending',
          requestStatus: 'Pending',
          totalSeasons: 3,
          childRequests: [
            {
              id: 1,
              parentRequestId: 2,
              seasonRequests: [],
              title: 'Test Show',
              approved: false,
              available: false,
              requestedDate: '2024-01-16T10:00:00Z',
              requestedUserId: 'user2',
              requestedByAlias: 'AnotherUser',
              requestType: 0,
              requestStatus: 'Pending',
            },
          ],
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/tv') return mockTVRequests;
        if (path === '/api/v1/Request/movie') return [];
        if (path === '/api/v1/Request/count') return { pending: 1, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoint = points.find(p => p.tags.type === 'Requests' && p.tags.request_type === 0);
      expect(requestPoint).toBeDefined();
      expect(requestPoint?.tags.title).toBe('Test Show');
      expect(requestPoint?.tags.status).toBe(3); // Pending
      expect(requestPoint?.tags.requested_user).toBe('AnotherUser');
    });

    it('should create Request_Total summary', async () => {
      const mockTVRequests: OmbiTVRequest[] = [
        {
          id: 1,
          tvDbId: 100,
          title: 'Show 1',
          status: 'Pending',
          requestStatus: 'Pending',
          totalSeasons: 1,
          childRequests: [
            {
              id: 1,
              parentRequestId: 1,
              seasonRequests: [],
              title: 'Show 1',
              approved: false,
              available: false,
              requestedDate: '2024-01-01',
              requestedUserId: 'user1',
              requestType: 0,
              requestStatus: 'Pending',
            },
          ],
        },
      ];
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 2,
          theMovieDbId: 200,
          title: 'Movie 1',
          status: 'Pending',
          requestStatus: 'Pending',
          approved: false,
          available: false,
          requestedDate: '2024-01-01',
          requestedUserId: 'user1',
          requestType: 1,
        },
        {
          id: 3,
          theMovieDbId: 300,
          title: 'Movie 2',
          status: 'Pending',
          requestStatus: 'Pending',
          approved: false,
          available: false,
          requestedDate: '2024-01-01',
          requestedUserId: 'user2',
          requestType: 1,
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/tv') return mockTVRequests;
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/count') return { pending: 3, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const totalPoint = points.find(p => p.tags.type === 'Request_Total');
      expect(totalPoint).toBeDefined();
      expect(totalPoint?.fields.total).toBe(3);
      expect(totalPoint?.fields.movies).toBe(2);
      expect(totalPoint?.fields.tv_shows).toBe(1);
    });

    it('should handle denied requests', async () => {
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 1,
          theMovieDbId: 123,
          title: 'Denied Movie',
          status: 'Denied',
          requestStatus: 'Denied',
          approved: false,
          available: false,
          denied: true,
          deniedReason: 'Not appropriate',
          requestedDate: '2024-01-15',
          requestedUserId: 'user1',
          requestType: 1,
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/count') return { pending: 0, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoint = points.find(p => p.tags.type === 'Requests');
      expect(requestPoint?.tags.status).toBe(0); // Denied
    });

    it('should handle approved but not available requests', async () => {
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 1,
          theMovieDbId: 123,
          title: 'Approved Movie',
          status: 'Approved',
          requestStatus: 'Approved',
          approved: true,
          available: false,
          requestedDate: '2024-01-15',
          requestedUserId: 'user1',
          requestType: 1,
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/count') return { pending: 0, approved: 1, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoint = points.find(p => p.tags.type === 'Requests');
      expect(requestPoint?.tags.status).toBe(1); // Approved only
    });

    it('should skip TV requests without child requests', async () => {
      const mockTVRequests: OmbiTVRequest[] = [
        {
          id: 1,
          tvDbId: 100,
          title: 'Show Without Children',
          status: 'Pending',
          requestStatus: 'Pending',
          totalSeasons: 1,
          childRequests: [], // Empty child requests
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/tv') return mockTVRequests;
        if (path === '/api/v1/Request/movie') return [];
        if (path === '/api/v1/Request/count') return { pending: 0, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoints = points.filter(p => p.tags.type === 'Requests');
      expect(requestPoints).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockRejectedValue(new Error('API Error'));

      const points = await plugin.collect();

      // Should return empty array without throwing
      expect(points).toEqual([]);
    });

    it('should use Unknown for missing requestedByAlias', async () => {
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 1,
          theMovieDbId: 123,
          title: 'Movie No Alias',
          status: 'Pending',
          requestStatus: 'Pending',
          approved: false,
          available: false,
          requestedDate: '2024-01-15',
          requestedUserId: 'user1',
          requestType: 1,
          // requestedByAlias is undefined
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/count') return { pending: 1, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points = await plugin.collect();

      const requestPoint = points.find(p => p.tags.type === 'Requests');
      expect(requestPoint?.tags.requested_user).toBe('Unknown');
    });
  });

  describe('hash generation', () => {
    it('should generate consistent hashes for same input', async () => {
      const mockMovieRequests: OmbiMovieRequest[] = [
        {
          id: 1,
          theMovieDbId: 123,
          title: 'Test Movie',
          status: 'Pending',
          requestStatus: 'Pending',
          approved: false,
          available: false,
          requestedDate: '2024-01-15',
          requestedUserId: 'user1',
          requestType: 1,
        },
      ];

      const httpGetSpy = vi.spyOn(plugin as unknown as { httpGet: <T>(path: string) => Promise<T> }, 'httpGet');
      httpGetSpy.mockImplementation(async (path: string) => {
        if (path === '/api/v1/Request/movie') return mockMovieRequests;
        if (path === '/api/v1/Request/tv') return [];
        if (path === '/api/v1/Request/count') return { pending: 1, approved: 0, available: 0 };
        if (path === '/api/v1/Issues/count') return { pending: 0, inProgress: 0, resolved: 0 };
        return null;
      });

      const points1 = await plugin.collect();
      const points2 = await plugin.collect();

      const hash1 = points1.find(p => p.tags.type === 'Requests')?.fields.hash;
      const hash2 = points2.find(p => p.tags.type === 'Requests')?.fields.hash;

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{32}$/); // MD5 hash format
    });
  });
});
