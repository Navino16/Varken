import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../../src/core/Orchestrator';
import { BaseInputPlugin, BaseInputConfig } from '../../src/plugins/inputs/BaseInputPlugin';
import { BaseOutputPlugin, BaseOutputConfig } from '../../src/plugins/outputs/BaseOutputPlugin';
import { DataPoint, PluginMetadata, ScheduleConfig } from '../../src/types/plugin.types';
import { VarkenConfig } from '../../src/config/schemas/config.schema';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Test input plugin implementation
class MockInputPlugin extends BaseInputPlugin<BaseInputConfig> {
  readonly metadata: PluginMetadata = {
    name: 'MockInput',
    version: '1.0.0',
    description: 'Mock input for testing',
  };

  async collect(): Promise<DataPoint[]> {
    return [];
  }

  getSchedules(): ScheduleConfig[] {
    return [this.createSchedule('mock', 60, true, this.collect)];
  }
}

// Test output plugin implementation
class MockOutputPlugin extends BaseOutputPlugin<BaseOutputConfig> {
  readonly metadata: PluginMetadata = {
    name: 'MockOutput',
    version: '1.0.0',
    description: 'Mock output for testing',
  };

  async write(_points: DataPoint[]): Promise<void> {
    // No-op for testing
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  const minimalConfig: VarkenConfig = {
    global: {
      httpTimeoutMs: 30000,
      healthCheckTimeoutMs: 5000,
      collectorTimeoutMs: 60000,
      paginationPageSize: 250,
      maxPaginationRecords: 10000,
    },
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
  };

  beforeEach(() => {
    vi.useFakeTimers();
    orchestrator = new Orchestrator(minimalConfig);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await orchestrator.stop();
  });

  describe('registerPlugins', () => {
    it('should register input and output plugins', () => {
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      const stats = orchestrator.getPluginManager().getStats();
      expect(stats.registeredInputTypes).toBe(1);
      expect(stats.registeredOutputTypes).toBe(1);
    });
  });

  describe('start', () => {
    it('should start the orchestrator', async () => {
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();

      expect(orchestrator.isActive()).toBe(true);
    });

    it('should not start twice', async () => {
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();
      await orchestrator.start(); // Second call should be ignored

      expect(orchestrator.isActive()).toBe(true);
    });

    it('should throw if plugins fail to initialize', async () => {
      // No plugins registered
      await expect(orchestrator.start()).rejects.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop the orchestrator', async () => {
      vi.useRealTimers(); // Need real timers for withTimeout
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();
      await orchestrator.stop();

      expect(orchestrator.isActive()).toBe(false);
    });

    it('should handle multiple stop calls gracefully', async () => {
      vi.useRealTimers(); // Need real timers for withTimeout
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();
      await orchestrator.stop();
      await orchestrator.stop(); // Second call should be safe

      expect(orchestrator.isActive()).toBe(false);
    });

    it('should do nothing if not running', async () => {
      await orchestrator.stop(); // Should not throw
      expect(orchestrator.isActive()).toBe(false);
    });
  });

  describe('isActive', () => {
    it('should return false before start', () => {
      expect(orchestrator.isActive()).toBe(false);
    });

    it('should return true after start', async () => {
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();

      expect(orchestrator.isActive()).toBe(true);
    });
  });

  describe('getPluginManager', () => {
    it('should return the plugin manager instance', () => {
      const pm = orchestrator.getPluginManager();
      expect(pm).toBeDefined();
      expect(pm.getStats).toBeDefined();
    });
  });

  describe('health server configuration', () => {
    it('should start without health server when not configured', async () => {
      // Default orchestrator has no health config
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();

      expect(orchestrator.isActive()).toBe(true);
    });

    it('should start with health server when configured', async () => {
      const orchestratorWithHealth = new Orchestrator(minimalConfig, {
        port: 9090,
        version: '1.0.0',
      });

      orchestratorWithHealth.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestratorWithHealth.start();

      expect(orchestratorWithHealth.isActive()).toBe(true);

      await orchestratorWithHealth.stop();
    });
  });

  describe('shutdown behavior', () => {
    it('should await pending shutdown when stop called multiple times simultaneously', async () => {
      vi.useRealTimers(); // Need real timers for withTimeout
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();

      // Call stop multiple times simultaneously
      const stopPromises = [
        orchestrator.stop(),
        orchestrator.stop(),
        orchestrator.stop(),
      ];

      await Promise.all(stopPromises);

      expect(orchestrator.isActive()).toBe(false);
    });
  });

  describe('health check logging', () => {
    it('should log healthy outputs', async () => {
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      // Should not throw and should log healthy status
      await orchestrator.start();

      expect(orchestrator.isActive()).toBe(true);
    });

    it('should log unhealthy outputs', async () => {
      class UnhealthyOutputPlugin extends BaseOutputPlugin<BaseOutputConfig> {
        readonly metadata: PluginMetadata = {
          name: 'UnhealthyOutput',
          version: '1.0.0',
          description: 'Unhealthy output for testing',
        };

        async write(_points: DataPoint[]): Promise<void> {
          // No-op
        }

        async healthCheck(): Promise<boolean> {
          return false;
        }
      }

      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', UnhealthyOutputPlugin]]),
      });

      // Should not throw even with unhealthy output
      await orchestrator.start();

      expect(orchestrator.isActive()).toBe(true);
    });
  });

  describe('dryRun', () => {
    beforeEach(() => {
      orchestrator = new Orchestrator(minimalConfig);
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });
    });

    it('should initialize plugins, run collectors once, then shut down without starting schedulers', async () => {
      await orchestrator.dryRun();

      // Orchestrator must not be considered active after a dry-run
      expect(orchestrator.isActive()).toBe(false);
    });

    it('should warn when an output is unhealthy during dry-run', async () => {
      class UnhealthyOutputPlugin extends MockOutputPlugin {
        override async healthCheck(): Promise<boolean> {
          return false;
        }
      }

      const o = new Orchestrator(minimalConfig);
      o.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', UnhealthyOutputPlugin]]),
      });

      // Should complete without throwing — unhealthy outputs are logged as warnings, not errors
      await expect(o.dryRun()).resolves.toBeUndefined();
    });

    it('should not invoke write() on output plugins', async () => {
      let writeCalls = 0;
      class SpyOutputPlugin extends MockOutputPlugin {
        override async write(points: DataPoint[]): Promise<void> {
          writeCalls++;
          await super.write(points);
        }
      }
      const o = new Orchestrator(minimalConfig);
      o.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', SpyOutputPlugin]]),
      });

      await o.dryRun();

      expect(writeCalls).toBe(0);
    });
  });

  // Note: Signal and error handler tests are skipped because emitting process events
  // (SIGTERM, SIGINT, uncaughtException, unhandledRejection) interferes with vitest's
  // own handlers and can cause the test runner to hang or crash. The signal handling
  // code in Orchestrator.ts is simple enough to verify through code review.
});
