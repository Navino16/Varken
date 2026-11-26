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
const valuesOf = (points: DataPoint[]): unknown[] => points.flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);
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

    it('omits seasons on movie requests', async () => {
      const page = loadFixture<{ pageInfo: object; results: components['schemas']['MediaRequest'][] }>('seerr/request');
      client.override('/api/v1/request', { ...page, results: [{ ...page.results[0], seasons: [] }] });

      const [dune] = await requests();

      expect(dune.fields).not.toHaveProperty('seasons');
    });

    it('never tags a requester with the e-mail Seerr uses as display name', async () => {
      const page = loadFixture<{ pageInfo: object; results: components['schemas']['MediaRequest'][] }>('seerr/request');
      const [dune] = page.results;
      client.override('/api/v1/request', { ...page, results: [{ ...dune, requestedBy: { ...dune.requestedBy!, displayName: 'alice@example.com' } }] });

      const [point] = await requests();

      expect(point.tags.requested_user).toBe('alice');
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
      });
      expect(queryOf(client, '/api/v1/media')).toContainEqual({ filter: 'allavailable', take: 1 });
      expect(queryOf(client, '/api/v1/media')).not.toContainEqual({ filter: 'deleted', take: 1 });
    });

    it('schedules the totals collector', () => {
      const schedules = plugin.getSchedules();

      expect(schedules.map((s) => s.name)).toEqual(['Overseerr_1_totals']);
      expect(schedules[0].intervalSeconds).toBe(300);
    });
  });

  describe('status', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ status: true }));
    });

    it('collects jobs with time to next run', async () => {
      const jobs = ofType(await plugin.collect(), 'Job');

      expect(jobs).toHaveLength(3);
      expect(jobs[0].tags).toMatchObject({ job_id: 'plex-recently-added-scan', job_type: 'process', interval: 'short' });
      expect(jobs[0].fields).toEqual({ name: 'Plex Recently Added Scan', running: 0, next_run_seconds: 600 });
      expect(jobs[1].fields.running).toBe(1);
    });

    it('collects image, DNS and API cache stats', async () => {
      const points = await plugin.collect();
      const [cache] = ofType(points, 'Cache');
      const apiCaches = ofType(points, 'ApiCache');

      expect(cache.fields).toEqual({
        tmdb_image_size: 184467200,
        tmdb_images: 1840,
        avatar_image_size: 2097152,
        avatar_images: 12,
        dns_size: 9,
        dns_max_size: 500,
        dns_hits: 1921,
        dns_misses: 101,
        dns_failures: 0,
        dns_ipv4_fallbacks: 2,
        dns_hit_rate: 0.95,
      });
      expect(cache.floatFields).toEqual(['dns_hit_rate']);
      expect(apiCaches.map((p) => p.tags.cache_id)).toEqual(['tmdb', 'radarr']);
      expect(apiCaches[0].fields).toEqual({ name: 'TMDb API', hits: 1520, misses: 310, keys: 284, key_size: 11360, value_size: 2390112 });
    });

    it('collects request and media totals with appdata state', async () => {
      const [status] = ofType(await plugin.collect(), 'Status');

      expect(status.fields).toEqual({ total_requests: 42, total_media_items: 118, appdata: 1, appdata_permissions: 1 });
    });

    it('never emits the appdata path', async () => {
      expect(valuesOf(await plugin.collect())).not.toContain('/app/config');
    });

    it('schedules the status collector', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Overseerr_1_status']);
    });
  });

  describe('users', () => {
    type UserPage = { pageInfo: { page: number; pages: number; results: number }; results: components['schemas']['User'][] };

    beforeEach(async () => {
      await plugin.initialize(config({ users: true }));
    });

    it('collects users with quotas', async () => {
      const points = await plugin.collect();
      const users = ofType(points, 'User');

      expect(users.map((p) => p.tags)).toEqual([
        { type: 'User', server: 1, user_id: 1, display_name: 'alice', user_type: 1 },
        { type: 'User', server: 1, user_id: 2, display_name: 'bob', user_type: 1 },
      ]);
      expect(users[0].fields).toEqual({
        requests: 12,
        movie_quota_limit: 10,
        movie_quota_days: 7,
        movie_quota_used: 6,
        movie_quota_remaining: 4,
        movie_quota_restricted: 0,
        tv_quota_used: 3,
        tv_quota_restricted: 0,
      });
      expect(ofType(points, 'Users')[0].fields).toEqual({ users: 2 });
      expect(queryOf(client, '/api/v1/user')).toEqual([{ sort: 'requests', take: 100, skip: 0 }]);
    });

    it('omits quota fields the service does not limit', async () => {
      const [alice] = ofType(await plugin.collect(), 'User');

      expect(alice.fields).not.toHaveProperty('tv_quota_limit');
      expect(alice.fields).not.toHaveProperty('tv_quota_remaining');
    });

    it('pages through users', async () => {
      const page = loadFixture<UserPage>('seerr/user');
      const many = Array.from({ length: 101 }, (_, i) => ({ ...page.results[0], id: i + 1, displayName: `user${i + 1}` }));
      client.override('/api/v1/user', (params) => {
        const skip = Number(params?.skip);
        return { pageInfo: { page: skip / 100 + 1, pages: 2, results: 101 }, results: many.slice(skip, skip + 100) };
      });

      const users = ofType(await plugin.collect(), 'User');

      expect(users).toHaveLength(101);
      expect(queryOf(client, '/api/v1/user').map((q) => q.skip)).toEqual([0, 100]);
    });

    it('never tags a user with the e-mail Seerr uses as display name', async () => {
      const page = loadFixture<UserPage>('seerr/user');
      const { username: _username, plexUsername: _plexUsername, ...alice } = page.results[0];
      client.override('/api/v1/user', { ...page, results: [{ ...alice, displayName: alice.email }] });

      const [user] = ofType(await plugin.collect(), 'User');

      expect(user.tags.display_name).toBe('user_1');
    });

    it('never emits user emails, tokens or avatars', async () => {
      const values = valuesOf(await plugin.collect());

      for (const secret of ['alice@example.com', 'plex-token-alice', 'jellyfin-token-bob', '/avatarproxy/1']) {
        expect(values).not.toContain(secret);
      }
    });

    it('schedules the users collector', () => {
      const [schedule] = plugin.getSchedules();

      expect(schedule.name).toBe('Overseerr_1_users');
      expect(schedule.intervalSeconds).toBe(300);
    });
  });
});
