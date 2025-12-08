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
      orchestrator.registerPlugins({
        inputPlugins: new Map([['sonarr', MockInputPlugin]]),
        outputPlugins: new Map([['influxdb1', MockOutputPlugin]]),
      });

      await orchestrator.start();
      await orchestrator.stop();

      expect(orchestrator.isActive()).toBe(false);
    });

    it('should handle multiple stop calls gracefully', async () => {
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
});
