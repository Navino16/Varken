import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { OverseerrPlugin } from '../../../src/plugins/inputs/OverseerrPlugin';
import { OverseerrConfigSchema } from '../../../src/config/schemas/config.schema';
import type { OverseerrConfig } from '../../../src/types/inputs/overseerr.types';
import type { components } from '../../../src/types/generated/seerr';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const NOW = new Date('2026-11-26T10:30:00Z');
const ARRIVAL_TMDB_ID = 329865;

type Key = 'requestCounts' | 'latestRequests' | 'status' | 'totals' | 'users';

function config(keys: Partial<Record<Key, boolean>>): OverseerrConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return OverseerrConfigSchema.parse({
    id: 1,
    url: 'http://overseerr.local:5055',
    apiKey: 'test-key',
    requestCounts: schedule(keys.requestCounts),
    latestRequests: { enabled: keys.latestRequests ?? false, count: 10, intervalSeconds: 300 },
    status: schedule(keys.status),
    totals: schedule(keys.totals),
    users: schedule(keys.users),
  }) as OverseerrConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
const callsTo = (client: ContractHttpClient, path: string): number => client.get.mock.calls.filter((call) => call[0] === path).length;
const queryOf = (client: ContractHttpClient, path: string): Record<string, unknown>[] =>
  client.get.mock.calls.filter((call) => call[0] === path).map((call) => (call[1] as { params: Record<string, unknown> }).params);

describe('OverseerrPlugin collectors', () => {
  let plugin: OverseerrPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    useEventStateFolder(null);
    plugin = new OverseerrPlugin();
    client = createContractHttpClient('seerr');
    (axios.create as Mock).mockReturnValue(client);
    client.override('/api/v1/movie/{movieId}', (_params, path) => ({
      ...loadFixture<components['schemas']['MovieDetails']>('seerr/movie'),
      title: path.endsWith(`/${ARRIVAL_TMDB_ID}`) ? 'Arrival' : 'Dune: Part Two',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('latest requests', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ latestRequests: true }));
    });

    const requests = async (): Promise<DataPoint[]> => ofType(await plugin.collect(), 'Requests');

    it('asks each title once across polls', async () => {
      await requests();
      await requests();

      expect(callsTo(client, '/api/v1/movie/693134')).toBe(1);
      expect(callsTo(client, `/api/v1/movie/${ARRIVAL_TMDB_ID}`)).toBe(1);
      expect(callsTo(client, '/api/v1/tv/95396')).toBe(1);
    });

    it('keeps a request whose title lookup fails', async () => {
      const tv = loadFixture<components['schemas']['TvDetails']>('seerr/tv');
      let calls = 0;
      client.override('/api/v1/tv/{tvId}', () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('TMDB rate limit');
        }
        return tv;
      });

      const first = (await requests()).find((p) => p.tags.request_type === 0);
      const second = (await requests()).find((p) => p.tags.request_type === 0);

      expect(first?.tags.title).toBe('unknown');
      expect(second?.tags.title).toBe('Severance');
      expect(calls).toBe(2);
    });

    it('keeps a request without tmdbId under an unknown title', async () => {
      const page = loadFixture<{ pageInfo: object; results: components['schemas']['MediaRequest'][] }>('seerr/request');
      const [dune] = page.results;
      const { tmdbId: _tmdbId, ...media } = dune.media ?? {};
      client.override('/api/v1/request', { ...page, results: [{ ...dune, media }] });

      const points = await requests();

      expect(points.map((p) => p.tags.title)).toEqual(['unknown']);
      expect(callsTo(client, '/api/v1/movie/693134')).toBe(0);
    });

    it('tags requests with 4K, media type and 4K media status', async () => {
      const points = await requests();
      const dune = points.find((p) => p.tags.title === 'Dune: Part Two');
      const arrival = points.find((p) => p.tags.title === 'Arrival');

      expect(dune?.tags).toMatchObject({ is_4k: 0, media_type: 'movie', media_status_4k: 1 });
      expect(arrival?.tags).toMatchObject({ is_4k: 1, media_type: 'movie', media_status_4k: 3 });
    });

    it('counts requested seasons', async () => {
      const points = await requests();

      expect(points.find((p) => p.tags.title === 'Severance')?.fields.seasons).toBe(2);
      expect(points.find((p) => p.tags.title === 'Dune: Part Two')?.fields).not.toHaveProperty('seasons');
    });
  });

  describe('request counts', () => {
    it('writes completed requests', async () => {
      await plugin.initialize(config({ requestCounts: true }));

      const [counts] = ofType(await plugin.collect(), 'Request_Counts');

      expect(counts.fields.completed).toBe(31);
    });
  });

  describe('totals', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ totals: true }));
      client.override('/api/v1/request', (params) => ({ pageInfo: { page: 1, pages: 1, results: { failed: 2, unavailable: 5, deleted: 1 }[String(params?.filter)] ?? 0 }, results: [] }));
      client.override('/api/v1/media', (params) => ({
        pageInfo: { page: 1, pages: 1, results: { all: 118, available: 90, partial: 6, allavailable: 96, processing: 4, pending: 3, deleted: 2 }[String(params?.filter)] ?? 0 },
        results: [],
      }));
    });

    it('collects filtered request totals', async () => {
      const [totals] = ofType(await plugin.collect(), 'RequestTotals');

      expect(totals.fields).toEqual({ failed: 2, unavailable: 5, deleted: 1 });
      expect(queryOf(client, '/api/v1/request')).toContainEqual({ filter: 'failed', take: 1 });
    });

    it('collects media totals by availability', async () => {
      const [totals] = ofType(await plugin.collect(), 'MediaTotals');

      expect(totals.fields).toEqual({
        total: 118,
        available: 90,
        partially_available: 6,
        all_available: 96,
        processing: 4,
        pending: 3,
        deleted: 2,
      });
      expect(queryOf(client, '/api/v1/media')).toContainEqual({ filter: 'allavailable', take: 1 });
    });

    it('schedules the totals collector', () => {
      const schedules = plugin.getSchedules();

      expect(schedules.map((s) => s.name)).toEqual(['Overseerr_1_totals']);
      expect(schedules[0].intervalSeconds).toBe(300);
    });
  });
});
