import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { OverseerrPlugin } from '../../../src/plugins/inputs/OverseerrPlugin';
import type { OverseerrConfig } from '../../../src/types/inputs/overseerr.types';
import type { components, paths } from '../../../src/types/generated/seerr';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type MovieDetails = components['schemas']['MovieDetails'];
type RequestPage = paths['/request']['get']['responses'][200]['content']['application/json'];

const ARRIVAL_TMDB_ID = 329865;

function duneDetails(): MovieDetails {
  return loadFixture<MovieDetails>('seerr/movie');
}

function arrivalDetails(): MovieDetails {
  const dune = duneDetails();
  const { media: _media, ...request } = loadFixture<RequestPage>('seerr/request').results?.[2] ?? { id: 0, status: 0, type: 'movie' };
  return {
    id: ARRIVAL_TMDB_ID,
    imdbId: 'tt2543164',
    title: 'Arrival',
    originalTitle: 'Arrival',
    releaseDate: '2016-11-10',
    runtime: 116,
    status: 'Released',
    voteAverage: 7.6,
    mediaInfo: {
      ...dune.mediaInfo,
      id: 116,
      tmdbId: ARRIVAL_TMDB_ID,
      status: 2,
      requests: [request],
    },
  };
}

function movieById(_params: unknown, path: string): MovieDetails {
  return path.endsWith(`/${ARRIVAL_TMDB_ID}`) ? arrivalDetails() : duneDetails();
}

describe('OverseerrPlugin', () => {
  let plugin: OverseerrPlugin;
  let client: ContractHttpClient;

  const testConfig: OverseerrConfig = {
    id: 1,
    url: 'http://localhost:5055',
    apiKey: 'overseerr-api-key',
    verifySsl: false,
    requestCounts: { enabled: true, intervalSeconds: 300 },
    latestRequests: { enabled: true, intervalSeconds: 60, count: 10 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new OverseerrPlugin();
    client = createContractHttpClient('seerr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Overseerr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects request counts and latest requests from Overseerr');
    });
  });

  describe('health', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/v1/status');
    });

    it('should pass the health check against the contract route', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(client.defaults.headers.common['X-Api-Key']).toBe('overseerr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Overseerr_1_request_counts', 300],
        ['Overseerr_1_latest_requests', 60],
      ]);
    });

    it('should only return request_counts schedule when latestRequests is disabled', async () => {
      await plugin.initialize({ ...testConfig, latestRequests: { ...testConfig.latestRequests, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Overseerr_1_request_counts']);
    });

    it('should only return latest_requests schedule when requestCounts is disabled', async () => {
      await plugin.initialize({ ...testConfig, requestCounts: { ...testConfig.requestCounts, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Overseerr_1_latest_requests']);
    });

    it('should run both count collectors from the request_counts schedule', async () => {
      await plugin.initialize(testConfig);

      const points = await plugin.getSchedules()[0].collector();

      expect(points.map((p) => p.tags.type)).toEqual(['Request_Counts', 'Issues_Counts']);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
      client.override('/api/v1/movie/{movieId}', movieById);
    });

    it('should collect request counts', async () => {
      const point = (await plugin.collect()).find((p) => p.tags.type === 'Request_Counts');

      expect(point?.fields).toEqual({
        pending: 3,
        approved: 5,
        processing: 2,
        available: 31,
        total: 42,
        movies: 30,
        tv: 12,
        declined: 1,
      });
    });

    it('should fall back to zero for absent counters', async () => {
      client.override('/api/v1/request/count', { total: 4 });
      client.override('/api/v1/issue/count', { open: 1 });

      const points = await plugin.collect();

      expect(points.find((p) => p.tags.type === 'Request_Counts')?.fields).toMatchObject({ total: 4, pending: 0 });
      expect(points.find((p) => p.tags.type === 'Issues_Counts')?.fields).toMatchObject({ open: 1, closed: 0 });
    });

    it('should collect issue counts', async () => {
      const point = (await plugin.collect()).find((p) => p.tags.type === 'Issues_Counts');

      expect(point?.fields).toEqual({ total: 7, video: 2, audio: 1, subtitles: 3, others: 1, open: 4, closed: 3 });
    });

    it('requests the latest requests with declared query parameters', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/api/v1/request', {
        params: { take: 10, filter: 'all', sort: 'added' },
      });
    });

    it('should collect latest movie requests', async () => {
      const dune = (await plugin.collect()).find((p) => p.tags.title === 'Dune: Part Two');

      expect(dune?.tags).toMatchObject({
        type: 'Requests',
        server: 1,
        request_type: 1,
        status: 5,
        requested_user: 'alice',
        requested_date: '2026-11-22T18:03:51.000Z',
      });
      expect(client.get).toHaveBeenCalledWith('/api/v1/movie/693134', { params: undefined });
    });

    it('should collect latest TV requests', async () => {
      const severance = (await plugin.collect()).find((p) => p.tags.title === 'Severance');

      expect(severance?.tags).toMatchObject({ request_type: 0, status: 4, requested_user: 'bob' });
      expect(client.get).toHaveBeenCalledWith('/api/v1/tv/95396', { params: undefined });
    });

    it('should skip requests without media tmdbId', async () => {
      const page = loadFixture<RequestPage>('seerr/request');
      const [dune, severance] = page.results ?? [];
      const { tmdbId: _tmdbId, ...mediaWithoutTmdb } = severance.media ?? {};
      client.override('/api/v1/request', { ...page, results: [dune, { ...severance, media: mediaWithoutTmdb }] });

      const requests = (await plugin.collect()).filter((p) => p.tags.type === 'Requests');

      expect(requests.map((p) => p.tags.title)).toEqual(['Dune: Part Two']);
      expect(client.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/v1\/tv\//), expect.anything());
    });

    it('should handle empty results gracefully', async () => {
      client.override('/api/v1/request', { pageInfo: { page: 1, pages: 0, results: 0 }, results: [] });

      const points = await plugin.collect();

      expect(points.map((p) => p.tags.type)).toEqual(['Request_Counts', 'Issues_Counts']);
    });

    it('should propagate API errors for circuit breaker', async () => {
      client.fail('/api/v1/request/count', new Error('Request counts API error'));

      await expect(plugin.collect()).rejects.toThrow('Request counts API error');
    });

    it('should handle media details fetch failure gracefully', async () => {
      client.fail('/api/v1/movie/{movieId}', new Error('Movie details error'));
      client.fail('/api/v1/tv/{tvId}', new Error('TV details error'));

      const points = await plugin.collect();

      expect(points.map((p) => p.tags.type)).toEqual(['Request_Counts', 'Issues_Counts']);
    });

    it('should collect successful requests even when one fails in parallel', async () => {
      client.override('/api/v1/movie/{movieId}', (params, path) => {
        if (path.endsWith(`/${ARRIVAL_TMDB_ID}`)) {
          throw new Error('TMDB API error');
        }
        return movieById(params, path);
      });

      const titles = (await plugin.collect()).filter((p) => p.tags.type === 'Requests').map((p) => p.tags.title);

      expect(titles).toEqual(['Dune: Part Two', 'Severance']);
    });

    it('should generate deterministic hash IDs', async () => {
      const hashes = async (): Promise<unknown[]> =>
        (await plugin.collect()).filter((p) => p.tags.type === 'Requests').map((p) => p.fields.hash);

      const first = await hashes();

      expect(first).toHaveLength(3);
      expect(new Set(first).size).toBe(3);
      expect(await hashes()).toEqual(first);
    });

    it('should handle missing requestedBy information', async () => {
      client.override('/api/v1/movie/{movieId}', () => {
        const dune = duneDetails();
        const requests = dune.mediaInfo?.requests?.map(({ requestedBy: _r, ...request }) => request);
        return { ...dune, mediaInfo: { ...dune.mediaInfo, requests } };
      });

      const dune = (await plugin.collect()).find((p) => p.tags.title === 'Dune: Part Two');

      expect(dune?.tags.requested_user).toBe('Unknown');
    });

    it('falls back when details have no mediaInfo', async () => {
      client.override('/api/v1/movie/{movieId}', () => {
        const { mediaInfo: _mediaInfo, ...dune } = duneDetails();
        return dune;
      });

      const dune = (await plugin.collect()).find((p) => p.tags.title === 'Dune: Part Two');

      expect(dune?.tags).toMatchObject({ status: 0, requested_user: 'Unknown', requested_date: '' });
    });

    it('should skip requests whose details have no title', async () => {
      client.override('/api/v1/tv/{tvId}', () => {
        const { name: _name, ...severance } = loadFixture<components['schemas']['TvDetails']>('seerr/tv');
        return severance;
      });

      const titles = (await plugin.collect()).filter((p) => p.tags.type === 'Requests').map((p) => p.tags.title);

      expect(titles).not.toContain('Severance');
      expect(titles).toHaveLength(2);
    });
  });

  it('does not collect when every collector is disabled', async () => {
    await plugin.initialize({
      ...testConfig,
      requestCounts: { ...testConfig.requestCounts, enabled: false },
      latestRequests: { ...testConfig.latestRequests, enabled: false },
    });

    expect(await plugin.collect()).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
