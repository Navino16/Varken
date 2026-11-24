import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { SonarrPlugin } from '../../../src/plugins/inputs/SonarrPlugin';
import { PROTOCOL_ID } from '../../../src/plugins/inputs/constants';
import type { SonarrConfig } from '../../../src/types/inputs/sonarr.types';
import type { components } from '../../../src/types/generated/sonarr';
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
type Episode = components['schemas']['EpisodeResource'];

const NOW = new Date('2026-11-24T12:00:00Z');
const queueRecords = (): QueueRecord[] => loadFixture<QueuePage>('sonarr/queue').records ?? [];
const calendar = (): Episode[] => loadFixture<Episode[]>('sonarr/calendar');
const page = (records: QueueRecord[] | null, totalRecords = records?.length ?? 0): QueuePage => ({
  page: 1,
  pageSize: 10,
  totalRecords,
  records,
});
/** Answers like Sonarr: only episodes airing between the requested bounds. */
const calendarBetween =
  (episodes: Episode[]) =>
  (params?: Record<string, unknown>): Episode[] =>
    episodes.filter((e) => (e.airDateUtc ?? '') >= String(params?.start) && (e.airDateUtc ?? '') <= String(params?.end));

describe('SonarrPlugin', () => {
  let plugin: SonarrPlugin;
  let client: ContractHttpClient;

  const testConfig: SonarrConfig = {
    id: 1,
    url: 'http://localhost:8989',
    apiKey: 'test-api-key',
    verifySsl: false,
    queue: { enabled: true, intervalSeconds: 30 },
    calendar: { enabled: true, intervalSeconds: 60, missingDays: 7, futureDays: 7 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    plugin = new SonarrPlugin();
    client = createContractHttpClient('sonarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Sonarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and calendar data from Sonarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(client.defaults.headers.common['X-Api-Key']).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Sonarr_1_queue', 30],
        ['Sonarr_1_calendar_missing', 60],
        ['Sonarr_1_calendar_future', 60],
      ]);
    });

    it('should only return queue schedule when calendar is disabled', async () => {
      await plugin.initialize({ ...testConfig, calendar: { ...testConfig.calendar, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Sonarr_1_queue']);
    });

    it('should only return calendar schedules when queue is disabled', async () => {
      await plugin.initialize({ ...testConfig, queue: { ...testConfig.queue, enabled: false } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Sonarr_1_calendar_missing', 'Sonarr_1_calendar_future']);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
      client.override('/api/v3/calendar', calendarBetween(calendar()));
    });

    const ofType = async (type: string): Promise<DataPoint[]> =>
      (await plugin.collect()).filter((p) => p.tags.type === type);

    it('collects queue items from the queue fixture', async () => {
      const points = await ofType('Queue');

      expect(points.map((p) => [p.tags.name, p.tags.epname, p.tags.sxe, p.tags.quality])).toEqual([
        ['Severance', 'Good News About Hell', 'S01E01', 'Bluray-1080p'],
        ['The Bear', 'Next', 'S03E02', 'WEBDL-2160p'],
      ]);
      expect(points[0].tags.sonarrId).toBe(10);
    });

    it('maps protocol ids', async () => {
      const points = await ofType('Queue');

      expect(points.map((p) => [p.tags.protocol, p.tags.protocol_id])).toEqual([
        ['USENET', PROTOCOL_ID.USENET],
        ['TORRENT', PROTOCOL_ID.TORRENT],
      ]);
    });

    it('skips queue items without series or episode data', async () => {
      const [severance, bear] = queueRecords();
      const { series: _series, ...withoutSeries } = severance;
      const { episode: _episode, ...withoutEpisode } = bear;
      client.override('/api/v3/queue', page([withoutSeries, withoutEpisode]));

      expect(await ofType('Queue')).toEqual([]);
    });

    it('falls back when optional queue fields are missing', async () => {
      const { quality: _quality, protocol: _protocol, ...bare } = queueRecords()[0];
      client.override('/api/v3/queue', page([bare]));

      const [point] = await ofType('Queue');

      expect(point.tags.quality).toBe('Unknown');
      expect(point.tags.protocol).toBe('UNKNOWN');
      expect(point.tags.protocol_id).toBe(PROTOCOL_ID.TORRENT);
    });

    it('handles an empty queue', async () => {
      client.override('/api/v3/queue', page([]));

      expect(await ofType('Queue')).toEqual([]);
    });

    it('handles null records in a queue page', async () => {
      client.override('/api/v3/queue', page(null));

      expect(await ofType('Queue')).toEqual([]);
    });

    it('paginates through large queues', async () => {
      const records = queueRecords();
      client.override('/api/v3/queue', (params) => page([records[Number(params?.page) - 1]], 2));

      expect(await ofType('Queue')).toHaveLength(2);
      expect(client.get).toHaveBeenCalledWith('/api/v3/queue', { params: expect.objectContaining({ page: 1 }) });
      expect(client.get).toHaveBeenCalledWith('/api/v3/queue', { params: expect.objectContaining({ page: 2 }) });
    });

    it('sends ISO date-time bounds to the calendar', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/api/v3/calendar', {
        params: { start: '2026-11-17T12:00:00.000Z', end: '2026-11-24T12:00:00.000Z', includeSeries: true },
      });
      expect(client.get).toHaveBeenCalledWith('/api/v3/calendar', {
        params: { start: '2026-11-24T12:00:00.000Z', end: '2026-12-01T12:00:00.000Z', includeSeries: true },
      });
    });

    it('collects only monitored missing episodes without files', async () => {
      const points = await ofType('Missing');

      expect(points.map((p) => [p.tags.name, p.tags.sxe, p.tags.epname, p.tags.downloaded, p.tags.airsUTC])).toEqual([
        ['Severance', 'S02E01', 'Hello, Ms. Cobel', 0, '2026-11-20T02:00:00Z'],
      ]);
    });

    it('collects future episodes', async () => {
      const points = await ofType('Future');

      expect(points.map((p) => [p.tags.name, p.tags.sxe, p.tags.sonarrId])).toEqual([['The Bear', 'S04E01', 11]]);
    });

    it('skips calendar episodes without series data', async () => {
      const episodes = calendar().map(({ series: _series, ...episode }) => episode);
      client.override('/api/v3/calendar', calendarBetween(episodes));

      expect(await ofType('Missing')).toEqual([]);
    });

    it('propagates API errors for the circuit breaker', async () => {
      client.fail('/api/v3/queue', new Error('boom'));

      await expect(plugin.collect()).rejects.toThrow('boom');
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
