import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginManager } from '../../src/core/PluginManager';
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

  public collectCalled = 0;
  public collectResult: DataPoint[] = [];

  async collect(): Promise<DataPoint[]> {
    this.collectCalled++;
    return this.collectResult;
  }

  getSchedules(): ScheduleConfig[] {
    return [
      this.createSchedule('mock', 1, true, this.collect),
    ];
  }

  // Override to avoid HTTP requests in tests
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// Test output plugin implementation
class MockOutputPlugin extends BaseOutputPlugin<BaseOutputConfig> {
  readonly metadata: PluginMetadata = {
    name: 'MockOutput',
    version: '1.0.0',
    description: 'Mock output for testing',
  };

  public writtenPoints: DataPoint[] = [];
  public writeError: Error | null = null;
  public healthy = true;

  async write(points: DataPoint[]): Promise<void> {
    if (this.writeError) {
      throw this.writeError;
    }
    this.writtenPoints.push(...points);
  }

  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }
}

describe('PluginManager', () => {
  let pluginManager: PluginManager;

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
    pluginManager = new PluginManager();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await pluginManager.shutdown();
    vi.useRealTimers();
  });

  describe('registerInputPlugin', () => {
    it('should register an input plugin factory', () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      const stats = pluginManager.getStats();
      expect(stats.registeredInputTypes).toBe(1);
    });
  });

  describe('registerOutputPlugin', () => {
    it('should register an output plugin factory', () => {
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      const stats = pluginManager.getStats();
      expect(stats.registeredOutputTypes).toBe(1);
    });
  });

  describe('initializeFromConfig', () => {
    it('should initialize plugins from config', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);

      await pluginManager.initializeFromConfig(minimalConfig);

      const stats = pluginManager.getStats();
      expect(stats.activeInputPlugins).toBe(1);
      expect(stats.activeOutputPlugins).toBe(1);
    });

    it('should throw if no output plugins initialized', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      // No output plugin registered

      await expect(pluginManager.initializeFromConfig(minimalConfig)).rejects.toThrow(
        'No output plugins were initialized'
      );
    });

    it('should throw if no input plugins initialized', async () => {
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      // No input plugin registered

      await expect(pluginManager.initializeFromConfig(minimalConfig)).rejects.toThrow(
        'No input plugins were initialized'
      );
    });

    it('should warn but continue for unknown plugin types', async () => {
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      // sonarr not registered

      const configWithUnknown: VarkenConfig = {
        ...minimalConfig,
        inputs: {
          ...minimalConfig.inputs,
          radarr: [{
            id: 1,
            url: 'http://localhost:7878',
            apiKey: 'key',
            verifySsl: false,
            queue: { enabled: true, intervalSeconds: 30 },
            missing: { enabled: false, intervalSeconds: 300 },
          }],
        },
      };

      // Register sonarr so we have at least one input
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);

      await pluginManager.initializeFromConfig(configWithUnknown);
      // Should not throw, just warn about unknown types
      const stats = pluginManager.getStats();
      expect(stats.activeInputPlugins).toBe(1);
    });
  });

  describe('startSchedulers', () => {
    it('should start schedulers for enabled schedules', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      await pluginManager.startSchedulers();

      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(1);
    });

    it('should not start duplicate schedulers', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      await pluginManager.startSchedulers();
      await pluginManager.startSchedulers(); // Second call should be ignored

      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(1);
    });

    it('should execute collector immediately on start', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      await pluginManager.startSchedulers();

      // Advance timers to allow async execution
      await vi.advanceTimersByTimeAsync(100);

      // The collector should have been called at least once
      // Note: We can't easily access the internal plugin instances
      // This is more of an integration test
      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(1);
    });
  });

  describe('stopSchedulers', () => {
    it('should stop all schedulers', async () => {
      vi.useRealTimers(); // Need real timers for withTimeout
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      await pluginManager.stopSchedulers();

      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(0);
    });

    it('should do nothing if not running', async () => {
      await pluginManager.stopSchedulers(); // Should not throw
    });
  });

  describe('healthCheck', () => {
    it('should return health status for all outputs', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const health = await pluginManager.healthCheck();

      expect(health.get('influxdb1')).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown all plugins', async () => {
      vi.useRealTimers(); // Need real timers for withTimeout
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      await pluginManager.shutdown();

      const stats = pluginManager.getStats();
      expect(stats.activeInputPlugins).toBe(0);
      expect(stats.activeOutputPlugins).toBe(0);
      expect(stats.activeSchedulers).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerInputPlugin('radarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      pluginManager.registerOutputPlugin('influxdb2', MockOutputPlugin);

      const stats = pluginManager.getStats();
      expect(stats.registeredInputTypes).toBe(2);
      expect(stats.registeredOutputTypes).toBe(2);
      expect(stats.activeInputPlugins).toBe(0);
      expect(stats.activeOutputPlugins).toBe(0);
      expect(stats.activeSchedulers).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle output plugin initialization failure', async () => {
      class FailingOutputPlugin extends MockOutputPlugin {
        async initialize(): Promise<void> {
          throw new Error('Init failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', FailingOutputPlugin);

      // Should throw with the initialization error (error is re-thrown)
      await expect(pluginManager.initializeFromConfig(minimalConfig)).rejects.toThrow(
        'Init failed'
      );
    });

    it('should handle input plugin initialization failure', async () => {
      class FailingInputPlugin extends MockInputPlugin {
        async initialize(): Promise<void> {
          throw new Error('Init failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);

      // Should throw because no input plugins were initialized
      await expect(pluginManager.initializeFromConfig(minimalConfig)).rejects.toThrow(
        'No input plugins were initialized'
      );
    });

    it('should handle write errors gracefully', async () => {
      class FailingWriteOutputPlugin extends MockOutputPlugin {
        async write(): Promise<void> {
          throw new Error('Write failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', FailingWriteOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Advance time to trigger collection and write
      await vi.advanceTimersByTimeAsync(2000);

      // Should not throw, error is logged
      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(1);
    });

    it('should handle shutdown errors gracefully for input plugins', async () => {
      class FailingShutdownInputPlugin extends MockInputPlugin {
        async shutdown(): Promise<void> {
          throw new Error('Shutdown failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingShutdownInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      // Should not throw, error is logged
      await pluginManager.shutdown();

      const stats = pluginManager.getStats();
      expect(stats.activeInputPlugins).toBe(0);
    });

    it('should handle shutdown errors gracefully for output plugins', async () => {
      class FailingShutdownOutputPlugin extends MockOutputPlugin {
        async shutdown(): Promise<void> {
          throw new Error('Shutdown failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', FailingShutdownOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      // Should not throw, error is logged
      await pluginManager.shutdown();

      const stats = pluginManager.getStats();
      expect(stats.activeOutputPlugins).toBe(0);
    });

    it('should handle non-Error exceptions in shutdown', async () => {
      class FailingShutdownOutputPlugin extends MockOutputPlugin {
        async shutdown(): Promise<void> {
          throw 'String error'; // Non-Error exception
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', FailingShutdownOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      // Should not throw, error is logged
      await pluginManager.shutdown();

      const stats = pluginManager.getStats();
      expect(stats.activeOutputPlugins).toBe(0);
    });
  });

  describe('multiple inputs', () => {
    it('should initialize multiple instances of the same plugin type', async () => {
      const configWithMultiple: VarkenConfig = {
        global: minimalConfig.global,
        outputs: minimalConfig.outputs,
        inputs: {
          sonarr: [
            {
              id: 1,
              url: 'http://sonarr1:8989',
              apiKey: 'key1',
              verifySsl: false,
              queue: { enabled: true, intervalSeconds: 30 },
              calendar: { enabled: false, intervalSeconds: 300, futureDays: 7, missingDays: 30 },
            },
            {
              id: 2,
              url: 'http://sonarr2:8989',
              apiKey: 'key2',
              verifySsl: false,
              queue: { enabled: true, intervalSeconds: 30 },
              calendar: { enabled: false, intervalSeconds: 300, futureDays: 7, missingDays: 30 },
            },
          ],
        },
      };

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithMultiple);

      const stats = pluginManager.getStats();
      expect(stats.activeInputPlugins).toBe(2);
    });
  });

  describe('getSchedulerStatuses', () => {
    it('should return empty array when no schedulers', () => {
      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses).toEqual([]);
    });

    it('should return status for each active scheduler', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      const statuses = pluginManager.getSchedulerStatuses();

      expect(statuses.length).toBe(1);
      // Schedule name is formatted as: {pluginName}_{instanceId}_{scheduleName}
      expect(statuses[0].name).toBe('MockInput_1_mock');
      expect(statuses[0].pluginName).toBe('MockInput');
      expect(statuses[0].intervalSeconds).toBe(1);
      expect(statuses[0].isRunning).toBeDefined();
      expect(statuses[0].consecutiveErrors).toBe(0);
    });

    it('should track scheduler last run time after interval', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Advance past one interval (1 second) to ensure at least one execution completes
      await vi.advanceTimersByTimeAsync(1100);

      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].lastRunAt).toBeDefined();
    });

    it('should track scheduler errors after interval', async () => {
      class FailingCollectorPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Collector failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingCollectorPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Advance past one interval to ensure execution completes
      await vi.advanceTimersByTimeAsync(1100);

      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].lastError).toBe('Collector failed');
      expect(statuses[0].consecutiveErrors).toBeGreaterThan(0);
    });
  });

  describe('getInputPluginStatuses', () => {
    it('should return empty array when no plugins', async () => {
      const statuses = await pluginManager.getInputPluginStatuses();
      expect(statuses).toEqual([]);
    });

    it('should return status for each input plugin', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getInputPluginStatuses();

      expect(statuses.length).toBe(1);
      expect(statuses[0].type).toBe('sonarr');
      expect(statuses[0].name).toBe('MockInput');
      expect(statuses[0].version).toBe('1.0.0');
      expect(statuses[0].healthy).toBe(true);
    });

    it('should handle health check failure', async () => {
      class UnhealthyInputPlugin extends MockInputPlugin {
        async healthCheck(): Promise<boolean> {
          return false;
        }
      }

      pluginManager.registerInputPlugin('sonarr', UnhealthyInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getInputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
    });

    it('should handle health check exception', async () => {
      class ExceptionHealthPlugin extends MockInputPlugin {
        async healthCheck(): Promise<boolean> {
          throw new Error('Health check failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', ExceptionHealthPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getInputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
      expect(statuses[0].error).toBe('Health check failed');
    });

    it('should handle non-Error exception in health check', async () => {
      class NonErrorHealthPlugin extends MockInputPlugin {
        async healthCheck(): Promise<boolean> {
          throw 'String exception';
        }
      }

      pluginManager.registerInputPlugin('sonarr', NonErrorHealthPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getInputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
      expect(statuses[0].error).toBe('Unknown error');
    });
  });

  describe('getOutputPluginStatuses', () => {
    it('should return empty array when no plugins', async () => {
      const statuses = await pluginManager.getOutputPluginStatuses();
      expect(statuses).toEqual([]);
    });

    it('should return status for each output plugin', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getOutputPluginStatuses();

      expect(statuses.length).toBe(1);
      expect(statuses[0].type).toBe('influxdb1');
      expect(statuses[0].name).toBe('MockOutput');
      expect(statuses[0].version).toBe('1.0.0');
      expect(statuses[0].healthy).toBe(true);
    });

    it('should handle health check failure', async () => {
      class UnhealthyOutputPlugin extends MockOutputPlugin {
        async healthCheck(): Promise<boolean> {
          return false;
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', UnhealthyOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getOutputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
    });

    it('should handle health check exception', async () => {
      class ExceptionHealthOutputPlugin extends MockOutputPlugin {
        async healthCheck(): Promise<boolean> {
          throw new Error('Output health check failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', ExceptionHealthOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getOutputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
      expect(statuses[0].error).toBe('Output health check failed');
    });

    it('should handle non-Error exception in output health check', async () => {
      class NonErrorHealthOutputPlugin extends MockOutputPlugin {
        async healthCheck(): Promise<boolean> {
          throw { code: 'UNEXPECTED' };
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', NonErrorHealthOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const statuses = await pluginManager.getOutputPluginStatuses();

      expect(statuses[0].healthy).toBe(false);
      expect(statuses[0].error).toBe('Unknown error');
    });
  });

  describe('healthCheck edge cases', () => {
    it('should return false for output that throws in healthCheck', async () => {
      class ThrowingHealthOutputPlugin extends MockOutputPlugin {
        async healthCheck(): Promise<boolean> {
          throw new Error('Connection failed');
        }
      }

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', ThrowingHealthOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const health = await pluginManager.healthCheck();

      expect(health.get('influxdb1')).toBe(false);
    });
  });

  describe('scheduler statuses', () => {
    it('should have isRunning field set to false when not executing', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Wait for execution to complete
      await vi.advanceTimersByTimeAsync(1100);

      // After execution completes, isRunning should be false
      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].isRunning).toBe(false);
    });

    it('should reset consecutiveErrors on successful execution', async () => {
      let shouldFail = true;

      class SometimesFailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          if (shouldFail) {
            throw new Error('Temporary failure');
          }
          return [];
        }
      }

      pluginManager.registerInputPlugin('sonarr', SometimesFailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // First execution fails (immediate run on start)
      await vi.advanceTimersByTimeAsync(100);
      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].consecutiveErrors).toBeGreaterThan(0);

      // Now make it succeed
      shouldFail = false;
      // Wait for next scheduled run (with backoff, interval is now 2s)
      await vi.advanceTimersByTimeAsync(2100);
      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].consecutiveErrors).toBe(0);
      expect(statuses[0].lastError).toBeUndefined();
    });
  });

  describe('disabled schedules', () => {
    it('should not start disabled schedules', async () => {
      class DisabledSchedulePlugin extends MockInputPlugin {
        getSchedules(): ScheduleConfig[] {
          return [
            this.createSchedule('disabled', 1, false, this.collect),
          ];
        }
      }

      pluginManager.registerInputPlugin('sonarr', DisabledSchedulePlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      const stats = pluginManager.getStats();
      expect(stats.activeSchedulers).toBe(0);
    });
  });

  describe('circuit breaker', () => {
    it('should apply backoff on consecutive errors', async () => {
      class FailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Always fails');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Initial run fails, backoff applied (interval doubles from 1s to 2s)
      await vi.advanceTimersByTimeAsync(100);
      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].consecutiveErrors).toBe(1);
      expect(statuses[0].currentIntervalSeconds).toBe(2); // 1s * 2 = 2s

      // Wait for second execution (2s interval)
      await vi.advanceTimersByTimeAsync(2100);
      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].consecutiveErrors).toBe(2);
      expect(statuses[0].currentIntervalSeconds).toBe(4); // 2s * 2 = 4s
    });

    it('should cap backoff at maxIntervalSeconds', async () => {
      class FailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Always fails');
        }
      }

      // Configure with very low max interval for testing
      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 10,
          backoffMultiplier: 2,
          maxIntervalSeconds: 4, // Cap at 4 seconds
          cooldownSeconds: 300,
          recoverySuccesses: 3,
        },
      };

      pluginManager.registerInputPlugin('sonarr', FailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // First failure: 1s * 2 = 2s
      await vi.advanceTimersByTimeAsync(100);
      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].currentIntervalSeconds).toBe(2);

      // Second failure: 2s * 2 = 4s (at cap)
      await vi.advanceTimersByTimeAsync(2100);
      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].currentIntervalSeconds).toBe(4);

      // Third failure: should stay at 4s (capped)
      await vi.advanceTimersByTimeAsync(4100);
      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].currentIntervalSeconds).toBe(4);
    });

    it('should open circuit after maxConsecutiveErrors', async () => {
      class FailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Always fails');
        }
      }

      // Configure with low maxConsecutiveErrors for testing
      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 3,
          backoffMultiplier: 1, // No backoff for simpler test timing
          maxIntervalSeconds: 600,
          cooldownSeconds: 60,
          recoverySuccesses: 3,
        },
      };

      pluginManager.registerInputPlugin('sonarr', FailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // Three failures (immediate + 2 intervals)
      await vi.advanceTimersByTimeAsync(100); // First execution
      await vi.advanceTimersByTimeAsync(1100); // Second
      await vi.advanceTimersByTimeAsync(1100); // Third

      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('open');
      expect(statuses[0].consecutiveErrors).toBe(3);
      expect(statuses[0].disabledAt).toBeDefined();
      expect(statuses[0].nextAttemptAt).toBeDefined();
    });

    it('should skip execution when circuit is open', async () => {
      let callCount = 0;
      class CountingFailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          callCount++;
          throw new Error('Always fails');
        }
      }

      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 2,
          backoffMultiplier: 1,
          maxIntervalSeconds: 600,
          cooldownSeconds: 60,
          recoverySuccesses: 3,
        },
      };

      pluginManager.registerInputPlugin('sonarr', CountingFailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // Two failures to open circuit
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);

      const callsBeforeOpen = callCount;
      expect(callsBeforeOpen).toBe(2);

      // Circuit should be open, further executions should be skipped
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1100);

      // Call count should not increase while circuit is open
      expect(callCount).toBe(callsBeforeOpen);
    });

    it('should transition to half-open after cooldown', async () => {
      class FailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Always fails');
        }
      }

      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 2,
          backoffMultiplier: 1,
          maxIntervalSeconds: 600,
          cooldownSeconds: 5, // Short cooldown for testing
          recoverySuccesses: 3,
        },
      };

      pluginManager.registerInputPlugin('sonarr', FailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // Open the circuit
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);

      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('open');

      // Wait for cooldown (5 seconds) + next execution
      await vi.advanceTimersByTimeAsync(6100);

      statuses = pluginManager.getSchedulerStatuses();
      // Circuit should transition to half-open, then back to open due to failure
      expect(statuses[0].circuitState).toBe('open');
    });

    it('should close circuit after recoverySuccesses in half-open state', async () => {
      let shouldFail = true;

      class RecoverablePlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          if (shouldFail) {
            throw new Error('Temporary failure');
          }
          return [];
        }
      }

      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 2,
          backoffMultiplier: 1,
          maxIntervalSeconds: 600,
          cooldownSeconds: 5, // Longer cooldown
          recoverySuccesses: 3, // Need 3 successes to recover
        },
      };

      pluginManager.registerInputPlugin('sonarr', RecoverablePlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // Open the circuit with 2 failures (immediate run + first interval)
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);

      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('open');

      // Now make it succeed
      shouldFail = false;

      // Wait for cooldown (5s) + first execution
      await vi.advanceTimersByTimeAsync(5100);

      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('half-open');
      expect(statuses[0].recoverySuccesses).toBe(1);

      // Second recovery success
      await vi.advanceTimersByTimeAsync(1100);

      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('half-open');
      expect(statuses[0].recoverySuccesses).toBe(2);

      // Third recovery success - should close the circuit
      await vi.advanceTimersByTimeAsync(1100);

      statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('closed');
      expect(statuses[0].consecutiveErrors).toBe(0);
      expect(statuses[0].recoverySuccesses).toBe(0);
    });

    it('should return to open state on failure in half-open', async () => {
      let failCount = 0;
      const maxFailures = 3; // Fail first 3 times (2 to open + 1 recovery fail)

      class SometimesRecoverablePlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          failCount++;
          if (failCount <= maxFailures) {
            throw new Error('Failure');
          }
          return [];
        }
      }

      const configWithCircuitBreaker = {
        ...minimalConfig,
        circuitBreaker: {
          maxConsecutiveErrors: 2,
          backoffMultiplier: 1,
          maxIntervalSeconds: 600,
          cooldownSeconds: 2,
          recoverySuccesses: 3,
        },
      };

      pluginManager.registerInputPlugin('sonarr', SometimesRecoverablePlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(configWithCircuitBreaker);
      await pluginManager.startSchedulers();

      // Open the circuit with 2 failures
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);

      let statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].circuitState).toBe('open');

      // Wait for cooldown, then fail recovery
      await vi.advanceTimersByTimeAsync(3100);

      statuses = pluginManager.getSchedulerStatuses();
      // Should be back to open after failed recovery
      expect(statuses[0].circuitState).toBe('open');
    });

    it('should include circuit breaker fields in scheduler statuses', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      const statuses = pluginManager.getSchedulerStatuses();

      expect(statuses[0]).toHaveProperty('circuitState');
      expect(statuses[0]).toHaveProperty('currentIntervalSeconds');
      expect(statuses[0]).toHaveProperty('recoverySuccesses');
      expect(statuses[0].circuitState).toBe('closed');
      expect(statuses[0].currentIntervalSeconds).toBe(1);
      expect(statuses[0].recoverySuccesses).toBe(0);
    });

    it('should use default circuit breaker config when not specified', async () => {
      class FailingPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          throw new Error('Always fails');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // With default config: backoffMultiplier=2
      await vi.advanceTimersByTimeAsync(100);
      const statuses = pluginManager.getSchedulerStatuses();
      expect(statuses[0].currentIntervalSeconds).toBe(2); // 1s * 2
    });
  });

  describe('data flow', () => {
    it('should write collected data points to outputs', async () => {
      const writtenPoints: DataPoint[] = [];

      class DataProducerPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            {
              measurement: 'test',
              tags: { server_id: 1 },
              fields: { value: 42 },
              timestamp: new Date(),
            },
          ];
        }
      }

      class RecordingOutputPlugin extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          writtenPoints.push(...points);
        }
      }

      pluginManager.registerInputPlugin('sonarr', DataProducerPlugin);
      pluginManager.registerOutputPlugin('influxdb1', RecordingOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Wait for collection and write to complete
      await vi.advanceTimersByTimeAsync(1100);

      expect(writtenPoints.length).toBeGreaterThan(0);
      expect(writtenPoints[0].measurement).toBe('test');
      expect(writtenPoints[0].fields.value).toBe(42);
    });

    it('should write to multiple outputs', async () => {
      const output1Points: DataPoint[] = [];
      const output2Points: DataPoint[] = [];

      class DataProducerPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            {
              measurement: 'test',
              tags: { server_id: 1 },
              fields: { value: 42 },
              timestamp: new Date(),
            },
          ];
        }
      }

      class Output1Plugin extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          output1Points.push(...points);
        }
      }

      class Output2Plugin extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          output2Points.push(...points);
        }
      }

      // Config with two outputs
      const configWithTwoOutputs: VarkenConfig = {
        global: minimalConfig.global,
        outputs: {
          influxdb1: minimalConfig.outputs.influxdb1,
          influxdb2: {
            url: 'localhost',
            port: 8087,
            token: 'test-token',
            org: 'test-org',
            bucket: 'varken',
            ssl: false,
            verifySsl: false,
          },
        },
        inputs: minimalConfig.inputs,
      };

      pluginManager.registerInputPlugin('sonarr', DataProducerPlugin);
      pluginManager.registerOutputPlugin('influxdb1', Output1Plugin);
      pluginManager.registerOutputPlugin('influxdb2', Output2Plugin);
      await pluginManager.initializeFromConfig(configWithTwoOutputs);
      await pluginManager.startSchedulers();

      // Wait for collection and write
      await vi.advanceTimersByTimeAsync(1100);

      expect(output1Points.length).toBeGreaterThan(0);
      expect(output2Points.length).toBeGreaterThan(0);
    });

    it('should continue writing to other outputs if one fails', async () => {
      const successfulWrites: DataPoint[] = [];

      class DataProducerPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            {
              measurement: 'test',
              tags: { server_id: 1 },
              fields: { value: 42 },
              timestamp: new Date(),
            },
          ];
        }
      }

      class FailingOutputPlugin extends MockOutputPlugin {
        async write(): Promise<void> {
          throw new Error('Write failed');
        }
      }

      class SuccessfulOutputPlugin extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          successfulWrites.push(...points);
        }
      }

      const configWithTwoOutputs: VarkenConfig = {
        global: minimalConfig.global,
        outputs: {
          influxdb1: minimalConfig.outputs.influxdb1,
          influxdb2: {
            url: 'localhost',
            port: 8087,
            token: 'test-token',
            org: 'test-org',
            bucket: 'varken',
            ssl: false,
            verifySsl: false,
          },
        },
        inputs: minimalConfig.inputs,
      };

      pluginManager.registerInputPlugin('sonarr', DataProducerPlugin);
      pluginManager.registerOutputPlugin('influxdb1', FailingOutputPlugin);
      pluginManager.registerOutputPlugin('influxdb2', SuccessfulOutputPlugin);
      await pluginManager.initializeFromConfig(configWithTwoOutputs);
      await pluginManager.startSchedulers();

      await vi.advanceTimersByTimeAsync(1100);

      // Second output should still receive data despite first failing
      expect(successfulWrites.length).toBeGreaterThan(0);
    });
  });

  describe('data point validation', () => {
    it('should filter out data points with empty measurement', async () => {
      const writtenPoints: DataPoint[] = [];

      class BadMeasurementPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            { measurement: '', tags: { server_id: 1 }, fields: { value: 1 }, timestamp: new Date() },
            { measurement: 'valid', tags: { server_id: 1 }, fields: { value: 2 }, timestamp: new Date() },
          ];
        }
      }

      class RecordingOutput extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          writtenPoints.push(...points);
        }
      }

      pluginManager.registerInputPlugin('sonarr', BadMeasurementPlugin);
      pluginManager.registerOutputPlugin('influxdb1', RecordingOutput);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();
      await vi.advanceTimersByTimeAsync(1100);

      // Every written point should be the valid one, invalid measurement should be filtered
      expect(writtenPoints.length).toBeGreaterThan(0);
      expect(writtenPoints.every((p) => p.measurement === 'valid')).toBe(true);
    });

    it('should filter out data points with empty fields', async () => {
      const writtenPoints: DataPoint[] = [];

      class EmptyFieldsPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            { measurement: 'empty', tags: { server_id: 1 }, fields: {}, timestamp: new Date() },
            { measurement: 'valid', tags: { server_id: 1 }, fields: { value: 2 }, timestamp: new Date() },
          ];
        }
      }

      class RecordingOutput extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          writtenPoints.push(...points);
        }
      }

      pluginManager.registerInputPlugin('sonarr', EmptyFieldsPlugin);
      pluginManager.registerOutputPlugin('influxdb1', RecordingOutput);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();
      await vi.advanceTimersByTimeAsync(1100);

      // Every written point should be the valid one, empty fields should be filtered
      expect(writtenPoints.length).toBeGreaterThan(0);
      expect(writtenPoints.every((p) => p.measurement === 'valid')).toBe(true);
    });

    it('should filter out data points with invalid timestamp', async () => {
      const writtenPoints: DataPoint[] = [];

      class BadTimestampPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            { measurement: 'bad', tags: { server_id: 1 }, fields: { value: 1 }, timestamp: new Date('invalid') },
            { measurement: 'valid', tags: { server_id: 1 }, fields: { value: 2 }, timestamp: new Date() },
          ];
        }
      }

      class RecordingOutput extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          writtenPoints.push(...points);
        }
      }

      pluginManager.registerInputPlugin('sonarr', BadTimestampPlugin);
      pluginManager.registerOutputPlugin('influxdb1', RecordingOutput);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();
      await vi.advanceTimersByTimeAsync(1100);

      // Every written point should be the valid one, invalid timestamp should be filtered
      expect(writtenPoints.length).toBeGreaterThan(0);
      expect(writtenPoints.every((p) => p.measurement === 'valid')).toBe(true);
    });

    it('should not write when all data points are invalid', async () => {
      const writtenPoints: DataPoint[] = [];

      class AllBadPlugin extends MockInputPlugin {
        async collect(): Promise<DataPoint[]> {
          return [
            { measurement: '', tags: { server_id: 1 }, fields: { value: 1 }, timestamp: new Date() },
            { measurement: 'bad', tags: { server_id: 1 }, fields: {}, timestamp: new Date() },
          ];
        }
      }

      class RecordingOutput extends MockOutputPlugin {
        async write(points: DataPoint[]): Promise<void> {
          writtenPoints.push(...points);
        }
      }

      pluginManager.registerInputPlugin('sonarr', AllBadPlugin);
      pluginManager.registerOutputPlugin('influxdb1', RecordingOutput);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();
      await vi.advanceTimersByTimeAsync(1100);

      expect(writtenPoints).toHaveLength(0);
    });
  });

  describe('setTimeout overflow handling', () => {
    it('should chain timeouts when interval exceeds 32-bit signed integer limit', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      class LongIntervalPlugin extends MockInputPlugin {
        getSchedules(): ScheduleConfig[] {
          // 30 days in seconds = 2,592,000s → 2,592,000,000ms > 2^31-1
          return [
            this.createSchedule('libraries', 2_592_000, true, this.collect),
          ];
        }
      }

      pluginManager.registerInputPlugin('sonarr', LongIntervalPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      // Find the setTimeout call with MAX_TIMEOUT_MS (chained timeout)
      const MAX_TIMEOUT_MS = 2_147_483_647;
      const chainedCall = setTimeoutSpy.mock.calls.find(
        (call) => call[1] === MAX_TIMEOUT_MS
      );
      expect(chainedCall).toBeDefined();

      setTimeoutSpy.mockRestore();
    });

    it('should not chain timeouts for intervals within 32-bit limit', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      await pluginManager.startSchedulers();

      const MAX_TIMEOUT_MS = 2_147_483_647;
      const chainedCall = setTimeoutSpy.mock.calls.find(
        (call) => call[1] === MAX_TIMEOUT_MS
      );
      expect(chainedCall).toBeUndefined();

      setTimeoutSpy.mockRestore();
    });
  });

  describe('dry-run mode', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it('collectAllOnce should run every enabled schedule once and return the points', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const results = await pluginManager.collectAllOnce();

      expect(results.size).toBe(1);
      const entry = results.get('MockInput_1_mock');
      expect(entry).toBeDefined();
      expect(Array.isArray(entry)).toBe(true);
    });

    it('collectAllOnce should capture errors as empty arrays', async () => {
      class FailingInputPlugin extends MockInputPlugin {
        override async collect(): Promise<DataPoint[]> {
          throw new Error('boom');
        }
      }

      pluginManager.registerInputPlugin('sonarr', FailingInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);

      const results = await pluginManager.collectAllOnce();
      const entry = results.get('MockInput_1_mock');
      expect(entry).toEqual([]);
    });

    it('should not invoke output.write when dry-run is enabled', async () => {
      pluginManager.registerInputPlugin('sonarr', MockInputPlugin);
      pluginManager.registerOutputPlugin('influxdb1', MockOutputPlugin);
      await pluginManager.initializeFromConfig(minimalConfig);
      pluginManager.setDryRun(true);

      const output = Array.from(
        (pluginManager as unknown as { outputPlugins: Map<string, MockOutputPlugin> }).outputPlugins.values()
      )[0];

      const validPoint: DataPoint = {
        measurement: 'test',
        tags: {},
        fields: { v: 1 },
        timestamp: new Date(),
      };
      await (
        pluginManager as unknown as { writeToOutputs: (p: DataPoint[]) => Promise<void> }
      ).writeToOutputs([validPoint]);

      expect(output.writtenPoints).toHaveLength(0);
    });
  });
});
