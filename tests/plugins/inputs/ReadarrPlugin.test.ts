import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { ReadarrPlugin } from '../../../src/plugins/inputs/ReadarrPlugin';
import { PROTOCOL_ID } from '../../../src/plugins/inputs/constants';
import type { ReadarrConfig } from '../../../src/types/inputs/readarr.types';
import type { components } from '../../../src/types/generated/readarr';
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
type BookPage = components['schemas']['BookResourcePagingResource'];

const queueRecords = (): QueueRecord[] => loadFixture<QueuePage>('readarr/queue').records ?? [];
const missingBooks = (): BookPage => loadFixture<BookPage>('readarr/wanted-missing');
const page = (records: QueueRecord[] | null, totalRecords = records?.length ?? 0): QueuePage => ({
  page: 1,
  pageSize: 10,
  totalRecords,
  records,
});

describe('ReadarrPlugin', () => {
  let plugin: ReadarrPlugin;
  let client: ContractHttpClient;

  const testConfig: ReadarrConfig = {
    id: 1,
    url: 'http://localhost:8787',
    apiKey: 'readarr-api-key',
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
    plugin = new ReadarrPlugin();
    client = createContractHttpClient('readarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Readarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing books data from Readarr');
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
      expect(client.defaults.headers.common['X-Api-Key']).toBe('readarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Readarr_1_queue', 30],
        ['Readarr_1_missing', 300],
      ]);
    });

    it('should only return queue schedule when missing is disabled', async () => {
      await plugin.initialize({ ...testConfig, missing: { ...testConfig.missing, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Readarr_1_queue']);
    });

    it('should only return missing schedule when queue is disabled', async () => {
      await plugin.initialize({ ...testConfig, queue: { ...testConfig.queue, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Readarr_1_missing']);
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

      expect(points.map((p) => [p.tags.name, p.tags.quality, p.tags.bookId])).toEqual([
        ['The Dispossessed - Ursula K. Le Guin', 'EPUB', 11],
        ['Dune - Frank Herbert', 'MOBI', 21],
      ]);
    });

    it('maps protocol ids', async () => {
      const points = await ofType('Queue');

      expect(points.map((p) => [p.tags.protocol, p.tags.protocol_id])).toEqual([
        ['TORRENT', PROTOCOL_ID.TORRENT],
        ['USENET', PROTOCOL_ID.USENET],
      ]);
    });

    it('falls back when the queue author is missing', async () => {
      const { author: _author, ...withoutAuthor } = queueRecords()[0];
      client.override('/api/v1/queue', page([withoutAuthor]));

      expect((await ofType('Queue'))[0].tags.name).toBe('The Dispossessed - Unknown Author');
    });

    it('skips queue items without book data', async () => {
      const [first, second] = queueRecords();
      const { book: _book, ...withoutBook } = first;
      client.override('/api/v1/queue', page([withoutBook, second]));

      expect((await ofType('Queue')).map((p) => p.tags.name)).toEqual(['Dune - Frank Herbert']);
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

    it('requests the queue with unknown author items excluded', async () => {
      await ofType('Queue');

      const [, config] = (client.get as Mock).mock.calls.find(([path]) => path === '/api/v1/queue') ?? [];
      expect(config.params).toMatchObject({ includeUnknownAuthorItems: false, includeBook: true, includeAuthor: true });
      expect(config.params).not.toHaveProperty('includeUnknownBookItems');
    });

    it('tags queue items with the book title slug', async () => {
      expect((await ofType('Queue')).map((p) => p.tags.titleSlug)).toEqual(['13651-the-dispossessed', '44767458-dune']);
    });

    it('paginates through large queues', async () => {
      const records = queueRecords();
      client.override('/api/v1/queue', (params) => page([records[Number(params?.page) - 1]], 2));

      expect(await ofType('Queue')).toHaveLength(2);
      expect(client.get).toHaveBeenCalledWith('/api/v1/queue', { params: expect.objectContaining({ page: 1 }) });
      expect(client.get).toHaveBeenCalledWith('/api/v1/queue', { params: expect.objectContaining({ page: 2 }) });
    });

    it('requests missing books with their author', async () => {
      const points = await ofType('Missing');

      expect(client.get).toHaveBeenCalledWith('/api/v1/wanted/missing', {
        params: expect.objectContaining({ includeAuthor: true, monitored: true }),
      });
      expect(points.map((p) => p.tags.name)).toEqual([
        'Exhalation - Ted Chiang',
        'Children of Dune - Frank Herbert',
        'The Left Hand of Darkness - Ursula K. Le Guin',
      ]);
      expect(points[2].tags).toMatchObject({ bookId: 12, foreignBookId: '18423', titleSlug: '18423-the-left-hand-of-darkness' });
    });

    it('falls back when a missing book has no author', async () => {
      const [first] = missingBooks().records ?? [];
      const { author: _author, ...withoutAuthor } = first;
      client.override('/api/v1/wanted/missing', { ...missingBooks(), totalRecords: 1, records: [withoutAuthor] });

      expect((await ofType('Missing'))[0].tags.name).toBe('Exhalation - Unknown Author');
    });

    it('handles no missing books', async () => {
      client.override('/api/v1/wanted/missing', { ...missingBooks(), totalRecords: 0, records: [] });

      expect(await ofType('Missing')).toEqual([]);
    });

    it('falls back when a missing book has no title or id', async () => {
      const [first] = missingBooks().records ?? [];
      const { title: _title, foreignBookId: _id, ...untitled } = first;
      client.override('/api/v1/wanted/missing', { ...missingBooks(), totalRecords: 1, records: [untitled] });

      const [point] = await ofType('Missing');

      expect(point.tags.name).toMatch(/^unknown - /);
      expect(point.tags.foreignBookId).toBe('unknown');
    });

    it('propagates queue API errors for the circuit breaker', async () => {
      client.fail('/api/v1/queue', new Error('Queue API Error'));

      await expect(plugin.collect()).rejects.toThrow('Queue API Error');
    });

    it('propagates missing books API errors for the circuit breaker', async () => {
      client.fail('/api/v1/wanted/missing', new Error('Missing API Error'));

      await expect(plugin.collect()).rejects.toThrow('Missing API Error');
    });

    it('generates deterministic hash ids', async () => {
      const first = (await plugin.collect()).map((p) => p.fields.hash);
      const second = (await plugin.collect()).map((p) => p.fields.hash);

      expect(second).toEqual(first);
    });
  });

  describe('server info', () => {
    const serverInfoOnly = (): ReadarrConfig => ({
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
        measurement: 'Readarr',
        tags: { type: 'ServerInfo', server: 1, version: '0.4.18.2805', branch: 'main' },
        fields: { update_available: 1, health_errors: 1, health_warnings: 1, health_notices: 0, uptime_seconds: 7200 },
      });
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Readarr_1_serverInfo']);
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
