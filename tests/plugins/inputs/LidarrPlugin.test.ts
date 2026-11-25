import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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
    serverInfo: { enabled: false, intervalSeconds: 300 },
    status: { enabled: false, intervalSeconds: 300 },
    totals: { enabled: false, intervalSeconds: 900 },
    history: { enabled: false, intervalSeconds: 300 },
    library: { enabled: false, intervalDays: 1 },
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

    it('enriches queue points with download state', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      const [point] = await ofType('Queue');
      vi.useRealTimers();

      expect(point.tags).toMatchObject({
        status: 'downloading',
        tracked_download_state: 'downloading',
        tracked_download_status: 'ok',
        download_client: 'qBittorrent',
        indexer: 'Redacted',
      });
      expect(point.fields).toEqual({ hash: expect.any(String), size: 524288000, sizeleft: 262144000, progress: 50, eta_seconds: 32400 });
      expect(point.floatFields).toEqual(['progress']);
    });

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

    it('handles no missing albums', async () => {
      client.override('/api/v1/wanted/missing', { ...missingAlbums(), totalRecords: 0, records: [] });

      expect(await ofType('Missing')).toEqual([]);
    });

    it('falls back when a missing album has no title or id', async () => {
      const [first] = missingAlbums().records ?? [];
      const { title: _title, foreignAlbumId: _id, ...untitled } = first;
      client.override('/api/v1/wanted/missing', { ...missingAlbums(), totalRecords: 1, records: [untitled] });

      const [point] = await ofType('Missing');

      expect(point.tags.name).toMatch(/^unknown - /);
      expect(point.tags.foreignAlbumId).toBe('unknown');
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

  describe('library', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const only = (keys: Partial<LidarrConfig>): LidarrConfig => ({
      ...testConfig,
      queue: { enabled: false, intervalSeconds: 30 },
      missing: { enabled: false, intervalSeconds: 30 },
      ...keys,
    });

    it('collects library statistics', async () => {
      await plugin.initialize(only({ library: { enabled: true, intervalDays: 2 } }));

      const points = await plugin.collect();
      const artists = points.filter((p) => p.tags.type === 'Artist');

      expect(artists.map((p) => p.tags)).toEqual([
        { type: 'Artist', server: 1, artistId: 1, name: 'Radiohead', status: 'continuing', ended: 0 },
        { type: 'Artist', server: 1, artistId: 2, name: 'Daft Punk', status: 'ended', ended: 1 },
      ]);
      expect(artists[0].fields).toEqual({
        monitored: 1,
        album_count: 9,
        track_file_count: 80,
        track_count: 100,
        total_track_count: 120,
        size_on_disk: 3221225472,
        percent_of_tracks: 80,
      });
      expect(artists[0].floatFields).toEqual(['percent_of_tracks']);
      expect(points.find((p) => p.tags.type === 'Library')?.fields).toEqual({
        artists: 2,
        artists_monitored: 1,
        albums: 13,
        tracks: 140,
        track_files: 110,
        total_tracks: 165,
        size_on_disk: 4294967296,
      });
      expect(plugin.getSchedules().find((s) => s.name === 'Lidarr_1_library')?.intervalSeconds).toBe(172800);
    });

    it('enriches missing points with release age and statistics', async () => {
      await plugin.initialize(only({ missing: { enabled: true, intervalSeconds: 300 } }));

      const [point] = await plugin.collect();

      expect(point.tags.album_type).toBe('Album');
      expect(point.fields).toEqual({
        hash: expect.any(String),
        release_age_days: 837,
        track_file_count: 3,
        track_count: 10,
        total_track_count: 12,
        size_on_disk: 104857600,
        percent_of_tracks: 30,
      });
      expect(point.floatFields).toEqual(['percent_of_tracks']);
    });

    it('omits release age for an undated release', async () => {
      await plugin.initialize(only({ missing: { enabled: true, intervalSeconds: 300 } }));

      const discovery = (await plugin.collect()).find((p) => p.tags.albumId === 22);

      expect(discovery?.fields).toEqual({ hash: expect.any(String) });
    });
  });

  describe('server info', () => {
    const serverInfoOnly = (): LidarrConfig => ({
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
        measurement: 'Lidarr',
        tags: { type: 'ServerInfo', server: 1, version: '3.1.6.5079', branch: 'main' },
        fields: { update_available: 1, health_errors: 1, health_warnings: 1, health_notices: 0, uptime_seconds: 7200 },
      });
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Lidarr_1_serverInfo']);
    });

    it('fails the server info collector when update fails', async () => {
      client.fail('/api/v1/update', new Error('Forbidden'));

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
