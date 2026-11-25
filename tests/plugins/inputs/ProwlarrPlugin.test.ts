import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { ProwlarrPlugin } from '../../../src/plugins/inputs/ProwlarrPlugin';
import type { ProwlarrConfig } from '../../../src/types/inputs/prowlarr.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';

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
      const points = await plugin.collect();

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
