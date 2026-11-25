import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { ProwlarrPlugin } from '../../../src/plugins/inputs/ProwlarrPlugin';
import type { ProwlarrConfig } from '../../../src/types/inputs/prowlarr.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';
import type { components } from '../../../src/types/generated/prowlarr';
import { loadFixture } from '../../contracts/registry';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

describe('ProwlarrPlugin', () => {
  let plugin: ProwlarrPlugin;
  let client: ContractHttpClient;

  const testConfig: ProwlarrConfig = {
    id: 1,
    url: 'http://localhost:9696',
    apiKey: 'prowlarr-api-key',
    verifySsl: false,
    indexerStats: { enabled: true, intervalSeconds: 300 },
    serverInfo: { enabled: false, intervalSeconds: 300 },
    status: { enabled: false, intervalSeconds: 300 },
    history: { enabled: false, intervalSeconds: 300 },
    inventory: { enabled: false, intervalSeconds: 3600 },
  };
  const disabled: ProwlarrConfig = { ...testConfig, indexerStats: { ...testConfig.indexerStats, enabled: false } };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new ProwlarrPlugin();
    client = createContractHttpClient('prowlarr');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Prowlarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects indexer statistics from Prowlarr');
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
      expect(client.defaults.headers.common['X-Api-Key']).toBe('prowlarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Prowlarr_1_indexerStats', 300]]);
    });

    it('should return empty schedules when indexerStats is disabled', async () => {
      await plugin.initialize(disabled);

      expect(plugin.getSchedules()).toEqual([]);
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('collects one point per indexer', async () => {
      const points = (await plugin.collect()).filter((p) => p.tags.type === 'IndexerStats');

      expect(points.map((p) => [p.tags.indexerId, p.tags.indexerName])).toEqual([
        [1, 'NZBgeek'],
        [2, 'Nyaa.si'],
        [5, 'DrunkenSlug'],
      ]);
    });

    it('includes all stats fields', async () => {
      const [nzbgeek] = await plugin.collect();

      expect(nzbgeek.fields).toMatchObject({
        averageResponseTime: 412,
        numberOfQueries: 1520,
        numberOfGrabs: 96,
        numberOfRssQueries: 288,
        numberOfAuthQueries: 4,
        numberOfFailedQueries: 12,
        numberOfFailedGrabs: 1,
        numberOfFailedRssQueries: 3,
        numberOfFailedAuthQueries: 0,
      });
    });

    it('handles empty indexer stats', async () => {
      client.override('/api/v1/indexerstats', { indexers: [] });

      expect(await plugin.collect()).toEqual([]);
    });

    it('handles null indexers', async () => {
      client.override('/api/v1/indexerstats', { indexers: null });

      expect(await plugin.collect()).toEqual([]);
    });

    it('handles a null response body', async () => {
      client.overrideUnchecked('/api/v1/indexerstats', null);

      expect(await plugin.collect()).toEqual([]);
    });

    it('propagates API errors for the circuit breaker', async () => {
      client.fail('/api/v1/indexerstats', new Error('API Error'));

      await expect(plugin.collect()).rejects.toThrow('API Error');
    });

    it('generates deterministic hash ids', async () => {
      const first = (await plugin.collect()).map((p) => p.fields.hash);
      const second = (await plugin.collect()).map((p) => p.fields.hash);

      expect(second).toEqual(first);
    });
  });

  describe('richer indexer stats', () => {
    const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
      await plugin.initialize(testConfig);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('enriches indexer stats with indexer settings', async () => {
      const stats = ofType(await plugin.collect(), 'IndexerStats');

      expect(stats.map((p) => [p.tags.indexerId, p.tags.protocol, p.tags.privacy, p.tags.enabled, p.tags.priority])).toEqual([
        [1, 'usenet', 'private', 1, 25],
        [2, 'torrent', 'public', 1, 25],
        [5, 'usenet', 'private', 0, 10],
      ]);
      expect(stats[0].fields.averageGrabResponseTime).toBe(830);
    });

    it('labels stats of an indexer missing from the indexer list unknown', async () => {
      client.override('/api/v1/indexer', loadFixture<components['schemas']['IndexerResource'][]>('prowlarr/indexer').slice(0, 1));

      const nyaa = ofType(await plugin.collect(), 'IndexerStats')[1];

      expect(nyaa.tags).toMatchObject({ protocol: 'unknown', privacy: 'unknown', enabled: 'unknown', priority: 'unknown' });
    });

    it('collects 24h windowed stats', async () => {
      const windowed = ofType(await plugin.collect(), 'IndexerStatsWindow');

      expect(client.get).toHaveBeenCalledWith('/api/v1/indexerstats', {
        params: { startDate: '2026-11-23T12:00:00.000Z', endDate: '2026-11-24T12:00:00.000Z' },
      });
      expect(windowed).toHaveLength(3);
      expect(windowed[0].tags).toMatchObject({ window: '24h', indexerId: 1, indexerName: 'NZBgeek', protocol: 'usenet' });
      expect(windowed[0].fields).toMatchObject({ numberOfQueries: 1520, averageGrabResponseTime: 830 });
    });

    it('collects user agent and host stats', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'UserAgentStats').map((p) => [p.tags.user_agent, p.fields])).toEqual([
        ['Sonarr/4.0.20.3014', { numberOfQueries: 1820, numberOfGrabs: 130 }],
      ]);
      expect(ofType(points, 'HostStats').map((p) => [p.tags.host, p.fields])).toEqual([['sonarr', { numberOfQueries: 1820, numberOfGrabs: 130 }]]);
    });
  });

  describe('status, history and inventory', () => {
    const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
    const only = (keys: Partial<ProwlarrConfig>): ProwlarrConfig => ({ ...disabled, ...keys });

    beforeEach(() => {
      useEventStateFolder(null);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('collects status points', async () => {
      await plugin.initialize(only({ status: { enabled: true, intervalSeconds: 300 } }));

      const points = await plugin.collect();

      expect(ofType(points, 'Health')[0].fields).toEqual({ errors: 1, warnings: 1, notices: 0 });
      expect(ofType(points, 'HealthIssue')).toHaveLength(2);
      expect(ofType(points, 'Task').map((p) => p.tags.task)).toEqual(['RefreshMonitoredDownloads', 'RssSync', 'Backup']);
      expect(ofType(points, 'IndexerStatus').map((p) => [p.tags.indexerId, p.fields])).toEqual([
        [2, { disabled: 1, disabled_for_seconds: 3600, most_recent_failure_age_seconds: 600, initial_failure_age_seconds: 7200 }],
        [5, { disabled: 0, most_recent_failure_age_seconds: 3900, initial_failure_age_seconds: 5400 }],
      ]);
      expect(ofType(points, 'IndexerStatusSummary')[0].fields).toEqual({ disabled_indexers: 1 });
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Prowlarr_1_status', 300]]);
    });

    it('collects grab history once', async () => {
      await plugin.initialize(only({ history: { enabled: true, intervalSeconds: 300 } }));

      const points = await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/api/v1/history/since', {
        params: { date: '2026-11-24T12:00:00.000Z', eventType: 'releaseGrabbed' },
      });
      expect(points.map((p) => [p.timestamp.toISOString(), p.tags, p.fields])).toEqual([
        [
          '2026-11-24T12:01:00.000Z',
          { type: 'History', server: 1, indexerId: 1, event_type: 'releaseGrabbed', successful: 1, source: 'Sonarr', grab_method: 'Proxy' },
          { hash: expect.stringMatching(/^[0-9a-f]{32}$/), elapsed_ms: 830 },
        ],
        [
          '2026-11-24T12:01:00.000Z',
          { type: 'History', server: 1, indexerId: 2, event_type: 'releaseGrabbed', successful: 0, source: 'Radarr', grab_method: 'Redirect' },
          { hash: expect.stringMatching(/^[0-9a-f]{32}$/) },
        ],
      ]);
      expect(await plugin.collect()).toEqual([]);
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Prowlarr_1_history', 300]]);
    });

    it('collects the inventory', async () => {
      await plugin.initialize(only({ inventory: { enabled: true, intervalSeconds: 3600 } }));

      const points = await plugin.collect();

      expect(ofType(points, 'Inventory')[0].fields).toEqual({ indexers: 3, indexers_enabled: 2, applications: 2, applications_syncing: 1 });
      expect(ofType(points, 'Application').map((p) => p.tags)).toEqual([
        { type: 'Application', server: 1, application: 'Sonarr', implementation: 'Sonarr', sync_level: 'fullSync' },
        { type: 'Application', server: 1, application: 'Radarr 4K', implementation: 'Radarr', sync_level: 'disabled' },
      ]);
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Prowlarr_1_inventory', 3600]]);
    });

    it('never emits indexer or application fields', async () => {
      await plugin.initialize(
        only({
          indexerStats: { enabled: true, intervalSeconds: 300 },
          status: { enabled: true, intervalSeconds: 300 },
          inventory: { enabled: true, intervalSeconds: 3600 },
        })
      );

      const values = (await plugin.collect()).flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);

      for (const secret of ['nzbgeek-secret-key', 'nyaa.si-secret-key', 'https://api.nzbgeek.info', 'sonarr-app-secret', 'radarr-app-secret']) {
        expect(values).not.toContain(secret);
      }
    });
  });

  it('does not collect when indexerStats is disabled', async () => {
    await plugin.initialize(disabled);

    expect(await plugin.collect()).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  describe('server info', () => {
    const serverInfoOnly = (): ProwlarrConfig => ({
      ...testConfig,
      indexerStats: { enabled: false, intervalSeconds: 30 },
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
        measurement: 'Prowlarr',
        tags: { type: 'ServerInfo', server: 1, version: '3.1.0.5799', branch: 'main' },
        fields: { update_available: 1, health_errors: 1, health_warnings: 1, health_notices: 0, uptime_seconds: 7200 },
      });
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Prowlarr_1_serverInfo']);
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
