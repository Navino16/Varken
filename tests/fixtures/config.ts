import type { VarkenConfig, GlobalConfig } from '../../src/config/schemas/config.schema';

export function createMockGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    httpTimeoutMs: 30000,
    healthCheckTimeoutMs: 5000,
    collectorTimeoutMs: 60000,
    paginationPageSize: 250,
    maxPaginationRecords: 10000,
    ...overrides,
  };
}

/**
 * Minimal valid `VarkenConfig` suitable for unit tests that need to drive
 * PluginManager / Orchestrator end to end.
 *
 * Override any top-level slice via `overrides`; everything else gets sensible
 * defaults (one Sonarr input with a `queue` schedule, one InfluxDB1 output).
 */
export function createMockVarkenConfig(overrides: Partial<VarkenConfig> = {}): VarkenConfig {
  return {
    global: createMockGlobalConfig(),
    outputs: {
      influxdb1: {
        url: 'localhost',
        port: 8086,
        username: 'root',
        password: 'root',
        database: 'varken',
        ssl: false,
        verifySsl: false,
      },
    },
    inputs: {
      sonarr: [
        {
          id: 1,
          url: 'http://localhost:8989',
          apiKey: 'test-key',
          verifySsl: false,
          queue: { enabled: true, intervalSeconds: 30 },
          calendar: { enabled: false, intervalSeconds: 300, futureDays: 7, missingDays: 30 },
        },
      ],
    },
    ...overrides,
  };
}
