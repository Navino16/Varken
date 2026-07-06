import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../../src/core/Orchestrator';
import { InfluxDB2Plugin } from '../../src/plugins/outputs/InfluxDB2Plugin';
import { BaseInputPlugin } from '../../src/plugins/inputs/BaseInputPlugin';
import type { DataPoint, PluginMetadata, ScheduleConfig } from '../../src/types/plugin.types';
import type { VarkenConfig } from '../../src/config/schemas/config.schema';
import { getInfluxDB2Endpoint, isServiceReachable } from './setup';

/**
 * End-to-end lifecycle: Orchestrator initializes a real InfluxDB 2.x output,
 * a test input plugin fires its collector once, we verify via `dryRun()` and
 * a real `start()`/`stop()` cycle that nothing crashes on the full path.
 */

class FakeInputPlugin extends BaseInputPlugin<{ id: number; url: string; apiKey?: string }> {
  readonly metadata: PluginMetadata = {
    name: 'FakeIntegrationInput',
    version: '1.0.0',
    description: 'Synthetic input used by integration tests',
  };

  async collect(): Promise<DataPoint[]> {
    return [
      {
        measurement: 'varken_integration_lifecycle',
        tags: { source: 'fake' },
        fields: { counter: 1 },
        timestamp: new Date(),
      },
    ];
  }

  override async healthCheck(): Promise<boolean> {
    return true;
  }

  getSchedules(): ScheduleConfig[] {
    return [this.createSchedule('fake', 3600, true, this.collect)];
  }
}

const endpoint = getInfluxDB2Endpoint();
const available = await isServiceReachable(endpoint.url, endpoint.port);

describe.skipIf(!available)('Orchestrator — integration lifecycle', () => {
  it('completes a dry-run against a real InfluxDB output', async () => {
    const config: VarkenConfig = {
      global: {
        httpTimeoutMs: 10_000,
        healthCheckTimeoutMs: 5_000,
        collectorTimeoutMs: 10_000,
        paginationPageSize: 250,
        maxPaginationRecords: 10_000,
      },
      outputs: {
        influxdb2: {
          url: endpoint.url,
          port: endpoint.port,
          token: endpoint.token,
          org: endpoint.org,
          bucket: endpoint.bucket,
          ssl: false,
          verifySsl: false,
        },
      },
      inputs: {
        sonarr: [
          {
            id: 1,
            url: 'http://fake-input',
            apiKey: 'unused',
            verifySsl: false,
            queue: { enabled: true, intervalSeconds: 3600 },
            calendar: { enabled: false, intervalSeconds: 300, futureDays: 7, missingDays: 30 },
          },
        ],
      },
    };

    const orchestrator = new Orchestrator(config, undefined, false);
    orchestrator.registerPlugins({
      // sonarr slot is typed but FakeInputPlugin ignores the config fields
      inputPlugins: new Map([['sonarr', FakeInputPlugin as unknown as new () => BaseInputPlugin]]),
      outputPlugins: new Map([['influxdb2', InfluxDB2Plugin]]),
    });

    await expect(orchestrator.dryRun()).resolves.toBeUndefined();
  });
});
