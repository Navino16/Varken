import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { OmbiPlugin } from '../../../src/plugins/inputs/OmbiPlugin';
import type { OmbiConfig } from '../../../src/types/inputs/ombi.types';
import type { components } from '../../../src/types/generated/ombi';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type MovieRequest = components['schemas']['Ombi.Store.Entities.Requests.MovieRequests'];
type TvRequest = components['schemas']['Ombi.Store.Entities.Requests.TvRequests'];

function movies(): MovieRequest[] {
  return loadFixture<MovieRequest[]>('ombi/request-movie');
}

function shows(): TvRequest[] {
  return loadFixture<TvRequest[]>('ombi/request-tv');
}

function requestPoint(points: DataPoint[], title: string): DataPoint | undefined {
  return points.find((p) => p.tags.type === 'Requests' && p.tags.title === title);
}

describe('OmbiPlugin', () => {
  let plugin: OmbiPlugin;
  let client: ContractHttpClient;

  const testConfig: OmbiConfig = {
    id: 1,
    url: 'http://localhost:3579',
    apiKey: 'test-api-key',
    verifySsl: false,
    requestCounts: { enabled: true, intervalSeconds: 300 },
    issueCounts: { enabled: true, intervalSeconds: 300 },
    serverInfo: { enabled: false, intervalSeconds: 300 },
    totals: { enabled: false, intervalSeconds: 300 },
    users: { enabled: false, intervalSeconds: 3600 },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new OmbiPlugin();
    client = createContractHttpClient('ombi');
    (axios.create as Mock).mockReturnValue(client);
    await plugin.initialize(testConfig);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Ombi');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('health', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/v1/Status');
    });

    it('should pass the health check against the contract route', async () => {
      await expect(plugin.healthCheck()).resolves.toBe(true);
    });
  });

  describe('initialize', () => {
    it('should set ApiKey header on initialization', () => {
      expect(client.defaults.headers.common.ApiKey).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Ombi_1_request_counts', 300],
        ['Ombi_1_issue_counts', 300],
      ]);
    });

    it('should only return request_counts schedule when issues disabled', async () => {
      await plugin.initialize({ ...testConfig, issueCounts: { enabled: false, intervalSeconds: 300 } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Ombi_1_request_counts']);
    });

    it('should return empty array when both disabled', async () => {
      await plugin.initialize({
        ...testConfig,
        requestCounts: { enabled: false, intervalSeconds: 300 },
        issueCounts: { enabled: false, intervalSeconds: 300 },
      });

      expect(plugin.getSchedules()).toEqual([]);
      expect(await plugin.collect()).toEqual([]);
      expect(client.get).not.toHaveBeenCalled();
    });

    it('should collect counts and requests from the request_counts schedule', async () => {
      const points = await plugin.getSchedules()[0].collector();

      expect(new Set(points.map((p) => p.tags.type))).toEqual(new Set(['Request_Counts', 'Requests', 'Request_Total']));
    });
  });

  describe('collect', () => {
    it('should collect request counts', async () => {
      const point = (await plugin.collect()).find((p) => p.tags.type === 'Request_Counts');

      expect(point?.fields).toEqual({ pending: 2, approved: 1, available: 1 });
    });

    it('should collect issue counts', async () => {
      const point = (await plugin.collect()).find((p) => p.tags.type === 'Issues_Counts');

      expect(point?.fields).toEqual({ pending: 3, in_progress: 1, resolved: 12 });
    });

    it('should process movie requests correctly', async () => {
      const dune = requestPoint(await plugin.collect(), 'Dune: Part Two');

      expect(dune?.tags).toMatchObject({
        server: 1,
        request_type: 1,
        status: 2,
        requested_user: 'Alice',
        requested_date: '2026-11-19T09:12:45.301Z',
      });
      expect(dune?.fields.hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should process TV requests correctly', async () => {
      const shogun = requestPoint(await plugin.collect(), 'Shōgun');

      expect(shogun?.tags).toMatchObject({
        request_type: 0,
        status: 3,
        requested_user: 'bob_dupont',
        requested_date: '2026-11-17T20:21:09.554Z',
      });
    });

    it('should create Request_Total summary', async () => {
      const total = (await plugin.collect()).find((p) => p.tags.type === 'Request_Total');

      expect(total?.fields).toEqual({ total: 5, movies: 3, tv_shows: 2 });
    });

    it('should handle denied requests', async () => {
      expect(requestPoint(await plugin.collect(), 'The Marvels')?.tags.status).toBe(0);
    });

    it('treats a null denied as not denied', async () => {
      const [oppenheimer] = movies();
      client.override('/api/v1/Request/movie', [{ ...oppenheimer, denied: null }]);

      expect(requestPoint(await plugin.collect(), 'Oppenheimer')?.tags.status).toBe(3);
    });

    it('should handle approved but not available requests', async () => {
      expect(requestPoint(await plugin.collect(), 'Severance')?.tags.status).toBe(1);
    });

    it('should skip TV requests without child requests but still count them', async () => {
      const [severance, shogun] = shows();
      client.override('/api/v1/Request/tv', [
        { ...severance, childRequests: [] },
        { ...shogun, childRequests: [] },
      ]);

      const points = await plugin.collect();

      expect(points.filter((p) => p.tags.request_type === 0)).toEqual([]);
      expect(points.find((p) => p.tags.type === 'Request_Total')?.fields.tv_shows).toBe(2);
    });

    it('should handle empty request lists', async () => {
      client.override('/api/v1/Request/movie', []);
      client.override('/api/v1/Request/tv', []);

      const points = await plugin.collect();

      expect(points.filter((p) => p.tags.type === 'Requests')).toEqual([]);
      expect(points.find((p) => p.tags.type === 'Request_Total')?.fields).toEqual({ total: 0, movies: 0, tv_shows: 0 });
    });

    it('should propagate API errors for circuit breaker', async () => {
      client.fail('/api/v1/Request/count', new Error('API Error'));

      await expect(plugin.collect()).rejects.toThrow('API Error');
    });

    it('should resolve userName from Identity API when alias is missing', async () => {
      expect(requestPoint(await plugin.collect(), 'Oppenheimer')?.tags.requested_user).toBe('bob_dupont');
    });

    it('should use alias from Identity API when user has one', async () => {
      expect(requestPoint(await plugin.collect(), 'Dune: Part Two')?.tags.requested_user).toBe('Alice');
    });

    it('should use requestedByAlias when the user is not returned by Identity API', async () => {
      expect(requestPoint(await plugin.collect(), 'The Marvels')?.tags.requested_user).toBe('Plex Guest');
    });

    it('should fallback to requestedByAlias when Identity API fails', async () => {
      client.fail('/api/v1/Identity/Users', new Error('Forbidden'));

      const points = await plugin.collect();

      expect(requestPoint(points, 'The Marvels')?.tags.requested_user).toBe('Plex Guest');
      expect(requestPoint(points, 'Dune: Part Two')?.tags.requested_user).toBe('Unknown');
    });

    it('should use Unknown when userId not in userMap and no alias', async () => {
      const [oppenheimer] = movies();
      client.override('/api/v1/Request/movie', [
        { ...oppenheimer, requestedUserId: '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b', requestedByAlias: null },
      ]);

      expect(requestPoint(await plugin.collect(), 'Oppenheimer')?.tags.requested_user).toBe('Unknown');
    });

    it('should use Unknown when the request has no user at all', async () => {
      const [oppenheimer] = movies();
      client.override('/api/v1/Request/movie', [{ ...oppenheimer, requestedUserId: null, requestedByAlias: null }]);

      expect(requestPoint(await plugin.collect(), 'Oppenheimer')?.tags.requested_user).toBe('Unknown');
    });

    it('should skip Identity users without id or name', async () => {
      const users = loadFixture<components['schemas']['Ombi.Core.Models.UI.UserViewModel'][]>('ombi/identity-users');
      client.override('/api/v1/Identity/Users', users.map((u) => ({ ...u, alias: null, userName: null })));

      expect(requestPoint(await plugin.collect(), 'Oppenheimer')?.tags.requested_user).toBe('Unknown');
    });

    it('should fall back for absent request fields', async () => {
      client.override('/api/v1/Request/movie', [{ id: 13, theMovieDbId: 550 }]);

      expect((await plugin.collect()).find((p) => p.tags.request_type === 1)?.tags).toMatchObject({
        status: 3,
        title: 'unknown',
        requested_user: 'Unknown',
        requested_date: '',
      });
    });
  });

  describe('hash generation', () => {
    it('should generate consistent hashes for same input', async () => {
      const hashes = async (): Promise<unknown[]> =>
        (await plugin.collect()).filter((p) => p.tags.type === 'Requests').map((p) => p.fields.hash);

      const first = await hashes();

      expect(first).toHaveLength(5);
      expect(new Set(first).size).toBe(5);
      expect(await hashes()).toEqual(first);
    });
  });
  describe('server info', () => {
    beforeEach(async () => {
      await plugin.initialize({
        ...testConfig,
        requestCounts: { enabled: false, intervalSeconds: 300 },
        issueCounts: { enabled: false, intervalSeconds: 300 },
        serverInfo: { enabled: true, intervalSeconds: 300 },
      });
    });

    it('collects server info', async () => {
      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        measurement: 'Ombi',
        tags: { type: 'ServerInfo', server: 1, version: '4.53.10', branch: 'master' },
        fields: { update_available: 1 },
      });
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Ombi_1_serverInfo']);
    });
  });
});
