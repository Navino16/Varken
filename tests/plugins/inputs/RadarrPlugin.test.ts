import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { RadarrPlugin } from '../../../src/plugins/inputs/RadarrPlugin';
import { PROTOCOL_ID } from '../../../src/plugins/inputs/constants';
import type { RadarrConfig } from '../../../src/types/inputs/radarr.types';
import type { components } from '../../../src/types/generated/radarr';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type QueuePage = components['schemas']['QueueResourcePagingResource'];
type QueueRecord = components['schemas']['QueueResource'];

const queueFixture = (): QueuePage => loadFixture<QueuePage>('radarr/queue');
const firstRecord = (): QueueRecord => (queueFixture().records ?? [])[0];
const page = (records: QueueRecord[] | null, totalRecords = records?.length ?? 0): QueuePage => ({
  page: 1,
  pageSize: 10,
  totalRecords,
  records,
});

describe('RadarrPlugin', () => {
  let plugin: RadarrPlugin;
  let client: ContractHttpClient;

  const testConfig: RadarrConfig = {
    id: 1,
    url: 'http://localhost:7878',
    apiKey: 'radarr-api-key',
    verifySsl: false,
    queue: { enabled: true, intervalSeconds: 30 },
    missing: { enabled: true, intervalSeconds: 300 },
    serverInfo: { enabled: false, intervalSeconds: 300 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new RadarrPlugin();
    client = createContractHttpClient('radarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Radarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing movies data from Radarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(client.defaults.headers.common['X-Api-Key']).toBe('radarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Radarr_1_queue', 30],
        ['Radarr_1_missing', 300],
      ]);
    });

    it('should only return queue schedule when missing is disabled', async () => {
      await plugin.initialize({ ...testConfig, missing: { ...testConfig.missing, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Radarr_1_queue']);
    });

    it('should only return missing schedule when queue is disabled', async () => {
      await plugin.initialize({ ...testConfig, queue: { ...testConfig.queue, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Radarr_1_missing']);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    const queuePoints = async (): Promise<Awaited<ReturnType<RadarrPlugin['collect']>>> =>
      (await plugin.collect()).filter((p) => p.tags.type === 'Queue');

    it('collects queue items from the queue fixture', async () => {
      const points = await queuePoints();

      expect(points.map((p) => p.tags.name)).toEqual(['Heat (1995)', 'Dune: Part Two (2024)']);
      expect(points.map((p) => p.tags.quality)).toEqual(['Bluray-1080p', 'WEBDL-2160p']);
      expect(points[0].tags.titleSlug).toBe('heat-949');
    });

    it('tags queue items with the movie tmdbId', async () => {
      const points = await queuePoints();

      expect(points.map((p) => p.tags.tmdbId)).toEqual([949, 693134]);
    });

    it('maps protocol ids', async () => {
      const points = await queuePoints();

      expect(points.map((p) => [p.tags.protocol, p.tags.protocol_id])).toEqual([
        ['USENET', PROTOCOL_ID.USENET],
        ['TORRENT', PROTOCOL_ID.TORRENT],
      ]);
    });

    it('collects only monitored movies without files', async () => {
      const points = (await plugin.collect()).filter((p) => p.tags.type === 'Missing');

      expect(points.map((p) => [p.tags.name, p.tags.Missing_Available, p.tags.tmdbId])).toEqual([
        ['Heat (1995)', 0, 949],
        ['Mickey 17 (2025)', 1, 696506],
      ]);
    });

    it('skips queue items without movie data', async () => {
      const { movie: _movie, ...withoutMovie } = firstRecord();
      const records = queueFixture().records ?? [];
      client.override('/api/v3/queue', page([withoutMovie, records[1]]));

      expect((await queuePoints()).map((p) => p.tags.name)).toEqual(['Dune: Part Two (2024)']);
    });

    it('falls back when optional queue fields are missing', async () => {
      const { quality: _quality, protocol: _protocol, ...bare } = firstRecord();
      client.override('/api/v3/queue', page([bare]));

      const [point] = await queuePoints();

      expect(point.tags.quality).toBe('Unknown');
      expect(point.tags.protocol).toBe('UNKNOWN');
      expect(point.tags.protocol_id).toBe(PROTOCOL_ID.TORRENT);
    });

    it('handles an empty queue', async () => {
      client.override('/api/v3/queue', page([]));

      expect(await queuePoints()).toEqual([]);
    });

    it('handles null records in a queue page', async () => {
      client.override('/api/v3/queue', page(null));

      expect(await queuePoints()).toEqual([]);
    });

    it('paginates through large queues', async () => {
      const records = queueFixture().records ?? [];
      client.override('/api/v3/queue', (params) => page([records[Number(params?.page) - 1]], 2));

      expect(await queuePoints()).toHaveLength(2);
      expect(client.get).toHaveBeenCalledWith('/api/v3/queue', expect.objectContaining({ params: expect.objectContaining({ page: 1 }) }));
      expect(client.get).toHaveBeenCalledWith('/api/v3/queue', expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }));
    });

    it('propagates API errors for the circuit breaker', async () => {
      client.fail('/api/v3/queue', new Error('boom'));

      await expect(plugin.collect()).rejects.toThrow('boom');
    });

    it('generates deterministic hash ids', async () => {
      const first = await queuePoints();
      const second = await queuePoints();

      expect(first[0].fields.hash).toBe(second[0].fields.hash);
    });
  });

  describe('server info', () => {
    const serverInfoOnly = (): RadarrConfig => ({
      ...testConfig,
      queue: { enabled: false, intervalSeconds: 30 },
      missing: { enabled: false, intervalSeconds: 30 },
      serverInfo: { enabled: true, intervalSeconds: 300 },
    });

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      await plugin.initialize(serverInfoOnly());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('collects server info', async () => {
      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        measurement: 'Radarr',
        tags: { type: 'ServerInfo', server: 1, version: '7.0.3.10918', branch: 'master' },
        fields: { update_available: 1, health_errors: 1, health_warnings: 1, health_notices: 0, uptime_seconds: 7200 },
      });
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Radarr_1_serverInfo']);
    });

    it('fails the server info collector when update fails', async () => {
      client.fail('/api/v3/update', new Error('Forbidden'));

      await expect(plugin.collect()).rejects.toThrow('Forbidden');
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
