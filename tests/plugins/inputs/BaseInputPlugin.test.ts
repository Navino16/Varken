import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseInputPlugin, BaseInputConfig } from '../../../src/plugins/inputs/BaseInputPlugin';
import { DataPoint, PluginMetadata, ScheduleConfig } from '../../../src/types/plugin.types';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Concrete implementation for testing
interface TestConfig extends BaseInputConfig {
  customField: string;
}

class TestInputPlugin extends BaseInputPlugin<TestConfig> {
  readonly metadata: PluginMetadata = {
    name: 'TestInput',
    version: '1.0.0',
    description: 'Test input plugin',
  };

  async collect(): Promise<DataPoint[]> {
    return [this.createDataPoint('test_measurement', { tag1: 'value1' }, { field1: 42 })];
  }

  getSchedules(): ScheduleConfig[] {
    return [
      this.createSchedule('test_schedule', 30, true, this.collect),
    ];
  }

  // Expose protected methods for testing
  public testCreateDataPoint(
    measurement: string,
    tags: Record<string, string | number>,
    fields: Record<string, string | number | boolean>
  ): DataPoint {
    return this.createDataPoint(measurement, tags, fields);
  }

  public testCreateSchedule(
    name: string,
    intervalSeconds: number,
    enabled: boolean,
    collector: () => Promise<DataPoint[]>
  ): ScheduleConfig {
    return this.createSchedule(name, intervalSeconds, enabled, collector);
  }

  public getHttpClient() {
    return this.httpClient;
  }
}

describe('BaseInputPlugin', () => {
  let plugin: TestInputPlugin;
  const testConfig: TestConfig = {
    id: 1,
    url: 'http://localhost:8989',
    apiKey: 'test-api-key',
    ssl: false,
    verifySsl: false,
    customField: 'custom',
  };

  beforeEach(() => {
    plugin = new TestInputPlugin();
  });

  describe('initialize', () => {
    it('should initialize with configuration', async () => {
      await plugin.initialize(testConfig);
      expect(plugin.getHttpClient()).toBeDefined();
    });

    it('should create HTTP client with correct base URL', async () => {
      await plugin.initialize(testConfig);
      expect(plugin.getHttpClient().defaults.baseURL).toBe('http://localhost:8989');
    });

    it('should preserve protocol if already in URL', async () => {
      await plugin.initialize({ ...testConfig, url: 'https://custom.local:8989' });
      expect(plugin.getHttpClient().defaults.baseURL).toBe('https://custom.local:8989');
    });

    it('should use HTTPS when ssl is enabled', async () => {
      await plugin.initialize({ ...testConfig, url: 'localhost:8989', ssl: true });
      expect(plugin.getHttpClient().defaults.baseURL).toBe('https://localhost:8989');
    });
  });

  describe('createDataPoint', () => {
    it('should create a data point with timestamp', async () => {
      await plugin.initialize(testConfig);
      const point = plugin.testCreateDataPoint(
        'test_measurement',
        { tag1: 'value1' },
        { field1: 42, field2: true }
      );

      expect(point.measurement).toBe('test_measurement');
      expect(point.tags).toEqual({ server_id: 1, tag1: 'value1' });
      expect(point.fields).toEqual({ field1: 42, field2: true });
      expect(point.timestamp).toBeInstanceOf(Date);
    });

    it('should include server_id in tags', async () => {
      await plugin.initialize(testConfig);
      const point = plugin.testCreateDataPoint('test', {}, { value: 1 });
      expect(point.tags.server_id).toBe(1);
    });
  });

  describe('createSchedule', () => {
    it('should create schedule with prefixed name', async () => {
      await plugin.initialize(testConfig);
      const collector = async () => [];
      const schedule = plugin.testCreateSchedule('test', 60, true, collector);

      expect(schedule.name).toBe('TestInput_1_test');
      expect(schedule.intervalSeconds).toBe(60);
      expect(schedule.enabled).toBe(true);
      expect(schedule.collector).toBeDefined();
    });
  });

  describe('collect', () => {
    it('should return data points', async () => {
      await plugin.initialize(testConfig);
      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0].measurement).toBe('test_measurement');
    });
  });

  describe('getSchedules', () => {
    it('should return schedule configurations', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('TestInput_1_test_schedule');
      expect(schedules[0].intervalSeconds).toBe(30);
      expect(schedules[0].enabled).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('should return true when service is reachable', async () => {
      await plugin.initialize(testConfig);
      // Mock the HTTP client get method
      plugin.getHttpClient().get = vi.fn().mockResolvedValue({ data: {} });

      const result = await plugin.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when service is unreachable', async () => {
      await plugin.initialize(testConfig);
      // Mock the HTTP client get method to throw
      plugin.getHttpClient().get = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await plugin.healthCheck();
      expect(result).toBe(false);
    });

    it('should use the default health endpoint', async () => {
      await plugin.initialize(testConfig);
      const getSpy = vi.fn().mockResolvedValue({ data: {} });
      plugin.getHttpClient().get = getSpy;

      await plugin.healthCheck();
      expect(getSpy).toHaveBeenCalledWith('/', expect.objectContaining({ timeout: 5000 }));
    });
  });
});
