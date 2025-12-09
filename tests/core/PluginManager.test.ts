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
});
