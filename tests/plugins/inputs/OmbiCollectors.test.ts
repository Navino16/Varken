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
});
