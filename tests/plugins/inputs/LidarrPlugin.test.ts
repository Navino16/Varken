import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { LidarrPlugin } from '../../../src/plugins/inputs/LidarrPlugin';
import { PROTOCOL_ID } from '../../../src/plugins/inputs/constants';
import type { LidarrConfig } from '../../../src/types/inputs/lidarr.types';
import type { components } from '../../../src/types/generated/lidarr';
import type { DataPoint } from '../../../src/types/plugin.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type QueuePage = components['schemas']['QueueResourcePagingResource'];
type QueueRecord = components['schemas']['QueueResource'];
type AlbumPage = components['schemas']['AlbumResourcePagingResource'];

const queueRecords = (): QueueRecord[] => loadFixture<QueuePage>('lidarr/queue').records ?? [];
const missingAlbums = (): AlbumPage => loadFixture<AlbumPage>('lidarr/wanted-missing');
const page = (records: QueueRecord[] | null, totalRecords = records?.length ?? 0): QueuePage => ({
  page: 1,
  pageSize: 10,
  totalRecords,
  records,
});

describe('LidarrPlugin', () => {
  let plugin: LidarrPlugin;
  let client: ContractHttpClient;

  const testConfig: LidarrConfig = {
    id: 1,
    url: 'http://localhost:8686',
    apiKey: 'lidarr-api-key',
    verifySsl: false,
    queue: { enabled: true, intervalSeconds: 30 },
    missing: { enabled: true, intervalSeconds: 300 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new LidarrPlugin();
    client = createContractHttpClient('lidarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Lidarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing albums data from Lidarr');
    });
  });

  describe('health', () => {
    it('should return the correct health endpoint', () => {
      const endpoint = (plugin as unknown as { getHealthEndpoint: () => string }).getHealthEndpoint();
      expect(endpoint).toBe('/api/v1/system/status');
    });

    it('should pass the health check against the contract route', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(client.defaults.headers.common['X-Api-Key']).toBe('lidarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Lidarr_1_queue', 30],
        ['Lidarr_1_missing', 300],
      ]);
    });

    it('should only return queue schedule when missing is disabled', async () => {
      await plugin.initialize({ ...testConfig, missing: { ...testConfig.missing, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Lidarr_1_queue']);
    });

    it('should only return missing schedule when queue is disabled', async () => {
      await plugin.initialize({ ...testConfig, queue: { ...testConfig.queue, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Lidarr_1_missing']);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    const ofType = async (type: string): Promise<DataPoint[]> =>
      (await plugin.collect()).filter((p) => p.tags.type === type);

    it('collects queue items from the queue fixture', async () => {
      const points = await ofType('Queue');

      expect(points.map((p) => [p.tags.name, p.tags.quality, p.tags.albumId])).toEqual([
        ['OK Computer - Radiohead', 'FLAC', 11],
        ['Random Access Memories - Daft Punk', 'MP3-320', 21],
      ]);
    });

    it('maps protocol ids', async () => {
      const points = await ofType('Queue');

      expect(points.map((p) => [p.tags.protocol, p.tags.protocol_id])).toEqual([
        ['TORRENT', PROTOCOL_ID.TORRENT],
        ['USENET', PROTOCOL_ID.USENET],
      ]);
    });

    it('falls back when the queue artist is missing', async () => {
      const { artist: _artist, ...withoutArtist } = queueRecords()[0];
      client.override('/api/v1/queue', page([withoutArtist]));

      expect((await ofType('Queue'))[0].tags.name).toBe('OK Computer - Unknown Artist');
    });

    it('skips queue items without album data', async () => {
      const [first, second] = queueRecords();
      const { album: _album, ...withoutAlbum } = first;
      client.override('/api/v1/queue', page([withoutAlbum, second]));

      expect((await ofType('Queue')).map((p) => p.tags.name)).toEqual(['Random Access Memories - Daft Punk']);
    });

    it('falls back when optional queue fields are missing', async () => {
      const { quality: _quality, protocol: _protocol, ...bare } = queueRecords()[0];
      client.override('/api/v1/queue', page([bare]));

      const [point] = await ofType('Queue');

      expect([point.tags.quality, point.tags.protocol, point.tags.protocol_id]).toEqual([
        'Unknown',
        'UNKNOWN',
        PROTOCOL_ID.TORRENT,
      ]);
    });

    it('handles an empty queue', async () => {
      client.override('/api/v1/queue', page([]));

      expect(await ofType('Queue')).toEqual([]);
    });

    it('handles null records in a queue page', async () => {
      client.override('/api/v1/queue', page(null));

      expect(await ofType('Queue')).toEqual([]);
    });

    it('paginates through large queues', async () => {
      const records = queueRecords();
      client.override('/api/v1/queue', (params) => page([records[Number(params?.page) - 1]], 2));

      expect(await ofType('Queue')).toHaveLength(2);
      expect(client.get).toHaveBeenCalledWith('/api/v1/queue', { params: expect.objectContaining({ page: 1 }) });
      expect(client.get).toHaveBeenCalledWith('/api/v1/queue', { params: expect.objectContaining({ page: 2 }) });
    });

    it('requests missing albums with their artist', async () => {
      const points = await ofType('Missing');

      expect(client.get).toHaveBeenCalledWith('/api/v1/wanted/missing', {
        params: expect.objectContaining({ includeArtist: true, monitored: true }),
      });
      expect(points.map((p) => p.tags.name)).toEqual([
        'Flight b741 - King Gizzard & the Lizard Wizard',
        'Discovery - Daft Punk',
        'Kid A - Radiohead',
      ]);
      expect(points[2].tags).toMatchObject({ albumId: 12, foreignAlbumId: 'b8f5a4d0-6b0c-3d5e-9c7f-6f4a1e2b3c4d' });
    });

    it('falls back when a missing album has no artist', async () => {
      const [first] = missingAlbums().records ?? [];
      const { artist: _artist, ...withoutArtist } = first;
      client.override('/api/v1/wanted/missing', { ...missingAlbums(), totalRecords: 1, records: [withoutArtist] });

      expect((await ofType('Missing'))[0].tags.name).toBe('Flight b741 - Unknown Artist');
    });

    it('propagates queue API errors for the circuit breaker', async () => {
      client.fail('/api/v1/queue', new Error('Queue API Error'));

      await expect(plugin.collect()).rejects.toThrow('Queue API Error');
    });

    it('propagates missing albums API errors for the circuit breaker', async () => {
      client.fail('/api/v1/wanted/missing', new Error('Missing API Error'));

      await expect(plugin.collect()).rejects.toThrow('Missing API Error');
    });

    it('generates deterministic hash ids', async () => {
      const first = (await plugin.collect()).map((p) => p.fields.hash);
      const second = (await plugin.collect()).map((p) => p.fields.hash);

      expect(second).toEqual(first);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
