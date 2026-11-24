import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
