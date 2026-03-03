import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseInputPlugin, BaseInputConfig, PaginatedResponse } from '../../../src/plugins/inputs/BaseInputPlugin';
import { DataPoint, PluginMetadata, ScheduleConfig } from '../../../src/types/plugin.types';
import type { GlobalConfig } from '../../../src/config/schemas/config.schema';

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

  public getGlobalConfig() {
    return this.globalConfig;
  }

  public testFetchAllPages<T>(endpoint: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.fetchAllPages<T>(endpoint, params);
  }
}

describe('BaseInputPlugin', () => {
  let plugin: TestInputPlugin;
  const testConfig: TestConfig = {
    id: 1,
    url: 'http://localhost:8989',
    apiKey: 'test-api-key',
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

    it('should use URL directly as baseURL', async () => {
      await plugin.initialize({ ...testConfig, url: 'https://localhost:8989' });
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
      expect(point.tags).toEqual({ tag1: 'value1' });
      expect(point.fields).toEqual({ field1: 42, field2: true });
      expect(point.timestamp).toBeInstanceOf(Date);
    });

    it('should not inject extra tags beyond those provided', async () => {
      await plugin.initialize(testConfig);
      const point = plugin.testCreateDataPoint('test', { server: 1 }, { value: 1 });
      expect(point.tags).toEqual({ server: 1 });
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

    it('should use custom healthCheckTimeoutMs from globalConfig', async () => {
      const customGlobal: GlobalConfig = {
        httpTimeoutMs: 30000,
        healthCheckTimeoutMs: 10000,
        collectorTimeoutMs: 60000,
        paginationPageSize: 250,
        maxPaginationRecords: 10000,
      };
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: {} });
      plugin.getHttpClient().get = getSpy;

      await plugin.healthCheck();
      expect(getSpy).toHaveBeenCalledWith('/', expect.objectContaining({ timeout: 10000 }));
    });
  });

  describe('globalConfig', () => {
    it('should use default globalConfig when not provided', async () => {
      await plugin.initialize(testConfig);
      const config = plugin.getGlobalConfig();

      expect(config.httpTimeoutMs).toBe(30000);
      expect(config.healthCheckTimeoutMs).toBe(5000);
      expect(config.collectorTimeoutMs).toBe(60000);
      expect(config.paginationPageSize).toBe(250);
      expect(config.maxPaginationRecords).toBe(10000);
    });

    it('should use provided globalConfig', async () => {
      const customGlobal: GlobalConfig = {
        httpTimeoutMs: 15000,
        healthCheckTimeoutMs: 3000,
        collectorTimeoutMs: 45000,
        paginationPageSize: 100,
        maxPaginationRecords: 5000,
      };
      await plugin.initialize(testConfig, customGlobal);
      const config = plugin.getGlobalConfig();

      expect(config.httpTimeoutMs).toBe(15000);
      expect(config.healthCheckTimeoutMs).toBe(3000);
      expect(config.collectorTimeoutMs).toBe(45000);
      expect(config.paginationPageSize).toBe(100);
      expect(config.maxPaginationRecords).toBe(5000);
    });

    it('should apply httpTimeoutMs to the HTTP client', async () => {
      const customGlobal: GlobalConfig = {
        httpTimeoutMs: 15000,
        healthCheckTimeoutMs: 5000,
        collectorTimeoutMs: 60000,
        paginationPageSize: 250,
        maxPaginationRecords: 10000,
      };
      await plugin.initialize(testConfig, customGlobal);
      expect(plugin.getHttpClient().defaults.timeout).toBe(15000);
    });
  });

  describe('fetchAllPages', () => {
    interface TestRecord {
      id: number;
      name: string;
    }

    it('should fetch all records in a single page', async () => {
      await plugin.initialize(testConfig);
      const response: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 250,
        totalRecords: 2,
        records: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ],
      };
      plugin.getHttpClient().get = vi.fn().mockResolvedValue({ data: response });

      const results = await plugin.testFetchAllPages<TestRecord>('/api/test');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('first');
      expect(results[1].name).toBe('second');
    });

    it('should fetch multiple pages', async () => {
      await plugin.initialize(testConfig);

      const page1: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 2,
        totalRecords: 3,
        records: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      };
      const page2: PaginatedResponse<TestRecord> = {
        page: 2,
        pageSize: 2,
        totalRecords: 3,
        records: [{ id: 3, name: 'c' }],
      };

      const getSpy = vi.fn()
        .mockResolvedValueOnce({ data: page1 })
        .mockResolvedValueOnce({ data: page2 });
      plugin.getHttpClient().get = getSpy;

      const results = await plugin.testFetchAllPages<TestRecord>('/api/test');

      expect(results).toHaveLength(3);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should pass additional params to each request', async () => {
      await plugin.initialize(testConfig);

      const response: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 250,
        totalRecords: 0,
        records: [],
      };
      const getSpy = vi.fn().mockResolvedValue({ data: response });
      plugin.getHttpClient().get = getSpy;

      await plugin.testFetchAllPages<TestRecord>('/api/test', { sortKey: 'name', monitored: true });

      expect(getSpy).toHaveBeenCalledWith('/api/test', {
        params: expect.objectContaining({
          sortKey: 'name',
          monitored: true,
          pageSize: 250,
          page: 1,
        }),
      });
    });

    it('should use paginationPageSize from globalConfig', async () => {
      const customGlobal: GlobalConfig = {
        httpTimeoutMs: 30000,
        healthCheckTimeoutMs: 5000,
        collectorTimeoutMs: 60000,
        paginationPageSize: 50,
        maxPaginationRecords: 10000,
      };
      await plugin.initialize(testConfig, customGlobal);

      const response: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 50,
        totalRecords: 0,
        records: [],
      };
      const getSpy = vi.fn().mockResolvedValue({ data: response });
      plugin.getHttpClient().get = getSpy;

      await plugin.testFetchAllPages<TestRecord>('/api/test');

      expect(getSpy).toHaveBeenCalledWith('/api/test', {
        params: expect.objectContaining({ pageSize: 50 }),
      });
    });

    it('should stop at maxPaginationRecords limit', async () => {
      const customGlobal: GlobalConfig = {
        httpTimeoutMs: 30000,
        healthCheckTimeoutMs: 5000,
        collectorTimeoutMs: 60000,
        paginationPageSize: 2,
        maxPaginationRecords: 3,
      };
      await plugin.initialize(testConfig, customGlobal);

      const page1: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 2,
        totalRecords: 100,
        records: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      };
      const page2: PaginatedResponse<TestRecord> = {
        page: 2,
        pageSize: 2,
        totalRecords: 100,
        records: [{ id: 3, name: 'c' }, { id: 4, name: 'd' }],
      };

      const getSpy = vi.fn()
        .mockResolvedValueOnce({ data: page1 })
        .mockResolvedValueOnce({ data: page2 });
      plugin.getHttpClient().get = getSpy;

      const results = await plugin.testFetchAllPages<TestRecord>('/api/test');

      // Should stop after page 2 because allRecords.length (4) >= maxRecords (3)
      expect(results).toHaveLength(4);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no records', async () => {
      await plugin.initialize(testConfig);

      const response: PaginatedResponse<TestRecord> = {
        page: 1,
        pageSize: 250,
        totalRecords: 0,
        records: [],
      };
      plugin.getHttpClient().get = vi.fn().mockResolvedValue({ data: response });

      const results = await plugin.testFetchAllPages<TestRecord>('/api/test');
      expect(results).toHaveLength(0);
    });
  });
});
