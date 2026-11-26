import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { OmbiPlugin } from '../../../src/plugins/inputs/OmbiPlugin';
import { OmbiConfigSchema } from '../../../src/config/schemas/config.schema';
import type { OmbiConfig } from '../../../src/types/inputs/ombi.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const NOW = new Date('2026-11-26T10:30:00Z');

type Key = 'requestCounts' | 'issueCounts' | 'totals' | 'users';

function config(keys: Partial<Record<Key, boolean>>): OmbiConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return OmbiConfigSchema.parse({
    id: 1,
    url: 'http://ombi.local:3579',
    apiKey: 'test-key',
    requestCounts: schedule(keys.requestCounts),
    issueCounts: schedule(keys.issueCounts),
    totals: schedule(keys.totals),
    users: schedule(keys.users),
  }) as OmbiConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
const valuesOf = (points: DataPoint[]): unknown[] => points.flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);
const queryOf = (client: ContractHttpClient, path: string): Record<string, unknown>[] =>
  client.get.mock.calls.filter((call) => call[0] === path).map((call) => (call[1] as { params: Record<string, unknown> }).params);

describe('OmbiPlugin collectors', () => {
  let plugin: OmbiPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    plugin = new OmbiPlugin();
    client = createContractHttpClient('ombi');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requests', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ requestCounts: true }));
    });

    const requests = async (): Promise<DataPoint[]> => ofType(await plugin.collect(), 'Requests');
    const byTitle = (points: DataPoint[], title: string): DataPoint[] => points.filter((p) => p.tags.title === title);

    it('writes denied requests', async () => {
      const [counts] = ofType(await plugin.collect(), 'Request_Counts');

      expect(counts.fields.denied).toBe(1);
    });

    it('emits one point per TV child request', async () => {
      const severance = byTitle(await requests(), 'Severance');

      expect(severance.map((p) => p.tags.status)).toEqual([1, 0]);
      expect(severance.map((p) => p.tags.requested_user)).toEqual(['Alice', 'bob_dupont']);
      expect(new Set(severance.map((p) => p.fields.hash)).size).toBe(2);
    });

    it('counts requested seasons and episodes', async () => {
      const [, denied] = byTitle(await requests(), 'Severance');

      expect(denied.fields).toMatchObject({ seasons: 2, episodes: 3, requester_progress: 40 });
    });

    it('collects music requests', async () => {
      const [album] = byTitle(await requests(), 'Random Access Memories');

      expect(album.tags).toMatchObject({ request_type: 2, status: 2, requested_user: 'Alice', source: 0 });
      expect(album.fields).toMatchObject({ approve_seconds: 1800, available_seconds: 52200 });
    });

    it('tags 4K movie requests', async () => {
      const points = await requests();

      expect(byTitle(points, 'Dune: Part Two')[0].tags.status_4k).toBe(1);
      expect(byTitle(points, 'Oppenheimer')[0].tags.status_4k).toBe('none');
    });

    it('measures time to approve and to available', async () => {
      const points = await requests();
      const [dune] = byTitle(points, 'Dune: Part Two');
      const [severance] = byTitle(points, 'Severance');

      expect(dune.fields).toMatchObject({ approve_seconds: 90134, available_seconds: 148634, played_by_users: 3, watched_by_requester: 1 });
      expect(severance.fields.approve_seconds).toBe(78);
      expect(severance.fields).not.toHaveProperty('available_seconds');
    });

    it('omits timings that never happened', async () => {
      const [oppenheimer] = byTitle(await requests(), 'Oppenheimer');

      expect(oppenheimer.fields).not.toHaveProperty('approve_seconds');
      expect(oppenheimer.fields).not.toHaveProperty('available_seconds');
    });

    it('never emits denial reasons', async () => {
      expect(valuesOf(await plugin.collect())).not.toContain('Not available in my region');
    });
  });

  describe('totals', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ totals: true }));
    });

    it('collects totals per media type and status', async () => {
      const totals = ofType(await plugin.collect(), 'Totals');

      expect(totals.map((p) => p.tags.media_type)).toEqual(['movie', 'tv', 'music']);
      expect(totals[0].fields).toEqual({ total: 3, available: 3, processing: 3, pending: 3, denied: 3, unavailable: 3 });
      expect(totals[1].fields).toEqual({ total: 2, available: 2, processing: 2, pending: 2, denied: 2, unavailable: 2 });
      expect(totals[2].fields).toEqual({ total: 1, available: 1, processing: 1, pending: 1, denied: 1 });
      expect(client.get).toHaveBeenCalledWith('/api/v2/Requests/album/denied/1/0/requestedDate/desc', { params: undefined });
    });

    it('asks stats for the last 30 days', async () => {
      const [stats] = ofType(await plugin.collect(), 'Stats');

      expect(stats.fields).toEqual({ movie_requests_30d: 4, tv_requests_30d: 2, completed_tv_30d: 1 });
      expect(queryOf(client, '/api/v1/Stats')).toEqual([{ from: '2026-10-27T10:30:00.000Z', to: '2026-11-26T10:30:00.000Z' }]);
    });

    it('keeps totals when stats answer 500', async () => {
      client.fail('/api/v1/Stats', Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));

      const points = await plugin.collect();

      expect(ofType(points, 'Stats')).toEqual([]);
      expect(ofType(points, 'Totals')).toHaveLength(3);
    });

    it('schedules the totals collector', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Ombi_1_totals']);
    });
  });

  describe('users', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ users: true }));
    });

    it('collects users with quotas and last login', async () => {
      const points = await plugin.collect();
      const users = ofType(points, 'User');

      expect(users.map((p) => p.tags.username)).toEqual(['Alice', 'bob_dupont']);
      expect(users[0].tags).toMatchObject({ user_id: '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f', user_type: 1 });
      expect(users[0].fields).toEqual({ has_logged_in: 1, last_login_age_seconds: 226069, movie_quota_limit: 5, movie_quota_remaining: 2 });
      expect(users[1].fields).toEqual({ has_logged_in: 1, last_login_age_seconds: 440666 });
      expect(ofType(points, 'Users')[0].fields).toEqual({ users: 2, logged_in_30d: 2 });
    });

    it('never emits user emails or passwords', async () => {
      const values = valuesOf(await plugin.collect());

      expect(values).not.toContain('alice@example.com');
      expect(values).not.toContain('hunter2');
    });

    it('schedules the users collector', () => {
      const [schedule] = plugin.getSchedules();

      expect(schedule.name).toBe('Ombi_1_users');
      expect(schedule.intervalSeconds).toBe(300);
    });
  });
});
