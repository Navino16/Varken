import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseInputPlugin, BaseInputConfig, PaginatedResponse } from '../../../src/plugins/inputs/BaseInputPlugin';
import { DataPoint, PluginMetadata, PointSpec, ScheduleConfig } from '../../../src/types/plugin.types';
import type { GlobalConfig } from '../../../src/config/schemas/config.schema';
import type { ApiClient } from '../../../src/types/api-contract';
import { getEventStateStore, useEventStateFolder } from '../../../src/utils/EventStateStore';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  withContext: (logger: unknown) => logger,
}));

// Concrete implementation for testing
type Responses<Body> = { 200: { headers: Record<string, unknown>; content: { 'application/json': Body } } };
interface ToyPaths {
  '/api/items/{id}': {
    get: { parameters: { query?: { lang?: string }; path: { id: number } }; responses: Responses<{ id: number }> };
  };
  '/api/count': {
    get: { parameters: { header?: { 'X-Page-Size'?: number } }; responses: Responses<{ total: number }> };
  };
  '/api/pages': {
    get: {
      parameters: { query?: { page?: number; pageSize?: number; tag?: string } };
      responses: Responses<{ page?: number; pageSize?: number; totalRecords?: number; records?: { id: number }[] | null }>;
    };
  };
}

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

  public testCreateServerInfoPoint(tags: Record<string, string | number>, fields: Record<string, number>): DataPoint {
    return this.createServerInfoPoint(tags, fields);
  }

  public testCreatePoints(specs: readonly PointSpec[]): DataPoint[] {
    return this.createPoints(specs);
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

  public testApi(basePath?: string): ApiClient<ToyPaths> {
    return this.api<ToyPaths>(basePath);
  }

  public testFetchAllPages<T>(endpoint: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.fetchAllPages<T>(endpoint, params);
  }

  public testValidateResponseData(response: unknown): void {
    return this.validateResponseData(response as import('axios').AxiosResponse);
  }

  public testOptionalFetch<T>(operation: string, statuses: readonly number[], fn: () => Promise<T>): Promise<T | undefined> {
    return this.optionalFetch(operation, statuses, fn);
  }

  public testSafeFetch<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return this.safeFetch(operation, fn);
  }

  public testHttpGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.httpGet<T>(path, params);
  }

  public testHttpPost<T>(path: string, data?: unknown): Promise<T> {
    return this.httpPost<T>(path, data);
  }

  public testEventCursor(collector: string): Promise<Date> {
    return this.eventCursor(collector);
  }

  public testTakeNewEvents(collector: string, events: readonly { id: number; date: string }[]): Promise<{ id: number; date: string }[]> {
    return this.takeNewEvents(collector, events, (e) => Date.parse(e.date), (e) => String(e.id));
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

    it('serializes object query parameters as top-level keys on the wire', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getHttpClient().getUri({ url: '/x', params: { mediaQuery: { type: 4, 'addedAt>>': '-7d' }, sort: ['a', 'b'] } })).toBe(
        'http://localhost:8989/x?type=4&addedAt%3E%3E=-7d&sort=a&sort=b'
      );
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

  describe('createServerInfoPoint', () => {
    it('writes a ServerInfo point under the plugin measurement', async () => {
      await plugin.initialize(testConfig);

      const point = plugin.testCreateServerInfoPoint({ version: '4.0.20' }, { update_available: 1 });

      expect(point.measurement).toBe('TestInput');
      expect(point.tags).toEqual({ type: 'ServerInfo', server: 1, version: '4.0.20' });
      expect(point.fields).toEqual({ reachable: 1, update_available: 1 });
    });
  });

  describe('createPoints', () => {
    it('writes specs under the plugin measurement with the server tag', async () => {
      await plugin.initialize(testConfig);
      const at = new Date('2026-11-25T10:00:00Z');

      const [point, timed] = plugin.testCreatePoints([
        { tags: { type: 'Health' }, fields: { errors: 1 } },
        { tags: { type: 'History' }, fields: { hash: 'x' }, timestamp: at, floatFields: ['ratio'] },
      ]);

      expect(point.measurement).toBe('TestInput');
      expect(point.tags).toEqual({ type: 'Health', server: 1 });
      expect(point.fields).toEqual({ errors: 1 });
      expect(point.floatFields).toBeUndefined();
      expect(timed.timestamp).toBe(at);
      expect(timed.floatFields).toEqual(['ratio']);
    });
  });

  describe('event cursor', () => {
    const T = '2026-11-25T10:05:00.000Z';
    const ev = (id: number, date: string): { id: number; date: string } => ({ id, date });

    beforeEach(async () => {
      useEventStateFolder(null);
      vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') });
      await plugin.initialize(testConfig);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts the cursor at plugin start when no mark exists', async () => {
      await expect(plugin.testEventCursor('history')).resolves.toEqual(new Date('2026-11-25T10:00:00Z'));
    });

    it('keeps only events after the mark', async () => {
      const fresh = await plugin.testTakeNewEvents('history', [ev(1, '2026-11-25T09:59:59Z'), ev(2, T)]);

      expect(fresh.map((e) => e.id)).toEqual([2]);
      await expect(plugin.testEventCursor('history')).resolves.toEqual(new Date(T));
    });

    it('emits events sharing the mark timestamp once', async () => {
      expect((await plugin.testTakeNewEvents('history', [ev(1, T), ev(2, T)])).map((e) => e.id)).toEqual([1, 2]);
      expect((await plugin.testTakeNewEvents('history', [ev(2, T), ev(3, T)])).map((e) => e.id)).toEqual([3]);
      expect(await plugin.testTakeNewEvents('history', [ev(1, T), ev(2, T), ev(3, T)])).toEqual([]);
    });

    it('skips events with an unparsable time', async () => {
      expect((await plugin.testTakeNewEvents('history', [ev(1, 'garbage'), ev(2, T)])).map((e) => e.id)).toEqual([2]);
    });

    it('persists the start mark on the first call even without new events', async () => {
      await plugin.testTakeNewEvents('history', []);

      await expect(getEventStateStore().get('TestInput_1_history')).resolves.toEqual({
        time: Date.parse('2026-11-25T10:00:00Z'),
        ids: [],
      });
    });

    it('resumes from the persisted mark after a restart', async () => {
      await plugin.testTakeNewEvents('history', [ev(1, T)]);
      vi.setSystemTime(new Date('2026-11-25T11:00:00Z'));
      const restarted = new TestInputPlugin();
      await restarted.initialize(testConfig);

      await expect(restarted.testEventCursor('history')).resolves.toEqual(new Date(T));
      expect((await restarted.testTakeNewEvents('history', [ev(1, T), ev(2, '2026-11-25T10:30:00Z')])).map((e) => e.id)).toEqual([2]);
    });

    it('keeps separate marks per collector', async () => {
      await plugin.testTakeNewEvents('history', [ev(1, T)]);

      await expect(plugin.testEventCursor('grabs')).resolves.toEqual(new Date('2026-11-25T10:00:00Z'));
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

  describe('api()', () => {
    it('expands path parameters and passes query parameters', async () => {
      await plugin.initialize(testConfig);
      const get = vi.fn().mockResolvedValue({ data: { id: 42 } });
      plugin.getHttpClient().get = get;

      const item = await plugin.testApi().get('/api/items/{id}', { path: { id: 42 }, query: { lang: 'en' } });

      expect(item).toEqual({ id: 42 });
      expect(get).toHaveBeenCalledWith('/api/items/42', { params: { lang: 'en' } });
    });

    it('collects every page of a paged endpoint with its query parameters', async () => {
      await plugin.initialize(testConfig);
      const get = vi
        .fn()
        .mockResolvedValueOnce({ data: { totalRecords: 2, records: [{ id: 1 }] } })
        .mockResolvedValueOnce({ data: { totalRecords: 2, records: [{ id: 2 }] } });
      plugin.getHttpClient().get = get;

      const records = await plugin.testApi().getAllPages('/api/pages', { query: { tag: 'x' } });

      expect(records).toEqual([{ id: 1 }, { id: 2 }]);
      expect(get).toHaveBeenNthCalledWith(1, '/api/pages', { params: expect.objectContaining({ tag: 'x', page: 1 }) });
      expect(get).toHaveBeenNthCalledWith(2, '/api/pages', { params: expect.objectContaining({ tag: 'x', page: 2 }) });
    });

    it('prefixes calls with the base path', async () => {
      await plugin.initialize(testConfig);
      const get = vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 42 } })
        .mockResolvedValueOnce({ data: { totalRecords: 1, records: [{ id: 1 }] } });
      plugin.getHttpClient().get = get;
      const client = plugin.testApi('/v2');

      await client.get('/api/items/{id}', { path: { id: 42 } });
      await client.getAllPages('/api/pages');

      expect(get).toHaveBeenNthCalledWith(1, '/v2/api/items/42', { params: undefined });
      expect(get).toHaveBeenNthCalledWith(2, '/v2/api/pages', { params: expect.objectContaining({ page: 1 }) });
    });
  });

  describe('api() headers', () => {
    it('passes declared headers to the request', async () => {
      await plugin.initialize(testConfig);
      const get = vi.fn().mockResolvedValue({ data: { total: 3 } });
      plugin.getHttpClient().get = get;

      await plugin.testApi().get('/api/count', { header: { 'X-Page-Size': 0 } });

      expect(get).toHaveBeenCalledWith('/api/count', { params: undefined, headers: { 'X-Page-Size': 0 } });
    });

    it('forwards headers on every page of a paged endpoint', async () => {
      await plugin.initialize(testConfig);
      const get = vi
        .fn()
        .mockResolvedValueOnce({ data: { totalRecords: 2, records: [{ id: 1 }] } })
        .mockResolvedValueOnce({ data: { totalRecords: 2, records: [{ id: 2 }] } });
      plugin.getHttpClient().get = get;

      await plugin.testApi().getAllPages('/api/pages', { header: { 'X-Page-Size': 1 } } as never);

      expect(get).toHaveBeenNthCalledWith(2, '/api/pages', {
        params: expect.objectContaining({ page: 2 }),
        headers: { 'X-Page-Size': 1 },
      });
    });

    it('caches calls with different headers separately', async () => {
      await plugin.initialize(testConfig, { cacheTtlSeconds: 60 } as unknown as GlobalConfig);
      const get = vi.fn().mockResolvedValueOnce({ data: { total: 3 } }).mockResolvedValueOnce({ data: { total: 0 } });
      plugin.getHttpClient().get = get;
      const client = plugin.testApi();

      const first = await client.get('/api/count', { header: { 'X-Page-Size': 0 } });
      const second = await client.get('/api/count', { header: { 'X-Page-Size': 5 } });

      expect([first, second]).toEqual([{ total: 3 }, { total: 0 }]);
      expect(get).toHaveBeenCalledTimes(2);
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

  describe('validateResponseData', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    const makeResponse = (data: unknown) => ({
      data,
      config: { url: '/api/test' },
    });

    it('should throw on HTML response with <!doctype', () => {
      expect(() => plugin.testValidateResponseData(makeResponse('<!DOCTYPE html><html><body>Login</body></html>')))
        .toThrow('Expected JSON but received HTML from /api/test');
    });

    it('should throw on HTML response with <html tag', () => {
      expect(() => plugin.testValidateResponseData(makeResponse('<html><body>Error</body></html>')))
        .toThrow('Expected JSON but received HTML from /api/test');
    });

    it('should throw on non-HTML string response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse('Not Found')))
        .toThrow('Expected JSON but received string from /api/test');
    });

    it('should throw on null response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse(null)))
        .toThrow('Expected JSON data but received nothing from /api/test');
    });

    it('should throw on undefined response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse(undefined)))
        .toThrow('Expected JSON data but received nothing from /api/test');
    });

    it('should pass through valid object response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse({ id: 1 }))).not.toThrow();
    });

    it('should pass through valid array response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse([1, 2, 3]))).not.toThrow();
    });

    it('should pass through number response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse(42))).not.toThrow();
    });

    it('should pass through boolean response', () => {
      expect(() => plugin.testValidateResponseData(makeResponse(true))).not.toThrow();
    });
  });

  describe('optionalFetch', () => {
    const failing = (status: number) => async (): Promise<never> => {
      throw Object.assign(new Error(`status ${status}`), { response: { status } });
    };

    it('returns the result when the request succeeds', async () => {
      await expect(plugin.testOptionalFetch('x', [403], async () => 7)).resolves.toBe(7);
    });

    it('returns undefined for a tolerated status', async () => {
      await expect(plugin.testOptionalFetch('x', [401, 403], failing(403))).resolves.toBeUndefined();
    });

    it('re-throws any other error', async () => {
      await expect(plugin.testOptionalFetch('x', [403], failing(500))).rejects.toThrow('status 500');
      await expect(plugin.testOptionalFetch('x', [403], async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    });
  });

  describe('safeFetch', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should return the inner function result when it succeeds', async () => {
      const result = await plugin.testSafeFetch('unit test', async () => 42);
      expect(result).toBe(42);
    });

    it('should re-throw errors with the operation context logged', async () => {
      await expect(
        plugin.testSafeFetch('fetch stuff', async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
    });

    it('should stringify non-Error thrown values', async () => {
      await expect(
        plugin.testSafeFetch('fetch stuff', async () => {
          throw 'string error';
        })
      ).rejects.toBe('string error');
    });
  });

  describe('httpGet caching', () => {
    it('deduplicates concurrent identical GETs into a single request', async () => {
      await plugin.initialize(testConfig);
      let resolveGet: (v: { data: unknown }) => void = () => {};
      const getSpy = vi.fn().mockImplementation(
        () => new Promise((res) => { resolveGet = res; })
      );
      plugin.getHttpClient().get = getSpy;

      const p1 = plugin.testHttpGet('/api/x');
      const p2 = plugin.testHttpGet('/api/x');
      resolveGet({ data: { ok: true } });
      await Promise.all([p1, p2]);

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('serves a cached response within cacheTtlSeconds', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('does not cache across sequential calls when cacheTtlSeconds is 0', async () => {
      await plugin.initialize(testConfig); // default: no cacheTtlSeconds -> 0
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('uses distinct cache keys for different params', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x', { page: 1 });
      await plugin.testHttpGet('/api/x', { page: 2 });

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('produces the same cache key regardless of param order', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x', { a: 1, b: 2 });
      await plugin.testHttpGet('/api/x', { b: 2, a: 1 });

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed GET', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await expect(plugin.testHttpGet('/api/x')).rejects.toThrow('boom');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('never caches httpPost', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const postSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().post = postSpy;

      await plugin.testHttpPost('/api/x', { a: 1 });
      await plugin.testHttpPost('/api/x', { a: 1 });

      expect(postSpy).toHaveBeenCalledTimes(2);
    });
  });
});
