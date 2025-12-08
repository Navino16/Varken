import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfluxDB2Plugin } from '../../../src/plugins/outputs/InfluxDB2Plugin';
import { DataPoint } from '../../../src/types/plugin.types';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock WriteApi
const mockWriteApi = {
  writePoint: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  useDefaultTags: vi.fn(),
};

// Mock InfluxDB client
vi.mock('@influxdata/influxdb-client', () => ({
  InfluxDB: vi.fn().mockImplementation(() => ({
    getWriteApi: vi.fn().mockReturnValue(mockWriteApi),
  })),
  Point: vi.fn().mockImplementation((measurement: string) => {
    const point = {
      _measurement: measurement,
      _tags: {} as Record<string, string>,
      _fields: {} as Record<string, unknown>,
      _timestamp: null as Date | null,
      tag: vi.fn().mockImplementation(function (this: typeof point, key: string, value: string) {
        this._tags[key] = value;
        return this;
      }),
      intField: vi.fn().mockImplementation(function (this: typeof point, key: string, value: number) {
        this._fields[key] = value;
        return this;
      }),
      floatField: vi.fn().mockImplementation(function (this: typeof point, key: string, value: number) {
        this._fields[key] = value;
        return this;
      }),
      stringField: vi.fn().mockImplementation(function (this: typeof point, key: string, value: string) {
        this._fields[key] = value;
        return this;
      }),
      booleanField: vi.fn().mockImplementation(function (this: typeof point, key: string, value: boolean) {
        this._fields[key] = value;
        return this;
      }),
      timestamp: vi.fn().mockImplementation(function (this: typeof point, ts: Date) {
        this._timestamp = ts;
        return this;
      }),
    };
    return point;
  }),
  HttpError: class HttpError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

// Mock Health API
vi.mock('@influxdata/influxdb-client-apis', () => ({
  HealthAPI: vi.fn().mockImplementation(() => ({
    getHealth: vi.fn().mockResolvedValue({ status: 'pass' }),
  })),
}));

describe('InfluxDB2Plugin', () => {
  let plugin: InfluxDB2Plugin;
  const testConfig = {
    url: 'localhost',
    port: 8086,
    token: 'test-token',
    org: 'varken',
    bucket: 'varken',
    ssl: false,
    verifySsl: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new InfluxDB2Plugin();
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('InfluxDB2');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });

    it('should handle SSL configuration', async () => {
      const sslConfig = { ...testConfig, ssl: true, verifySsl: true };
      await expect(plugin.initialize(sslConfig)).resolves.toBeUndefined();
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should write data points', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test_measurement',
          tags: { server_id: 1, host: 'test' },
          fields: { value: 42, active: true, name: 'test' },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);

      expect(mockWriteApi.writePoint).toHaveBeenCalledTimes(1);
      expect(mockWriteApi.flush).toHaveBeenCalledTimes(1);
    });

    it('should handle empty points array', async () => {
      await plugin.write([]);

      expect(mockWriteApi.writePoint).not.toHaveBeenCalled();
      expect(mockWriteApi.flush).not.toHaveBeenCalled();
    });

    it('should write multiple points', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test1',
          tags: { id: 1 },
          fields: { value: 10 },
          timestamp: new Date(),
        },
        {
          measurement: 'test2',
          tags: { id: 2 },
          fields: { value: 20 },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);

      expect(mockWriteApi.writePoint).toHaveBeenCalledTimes(2);
      expect(mockWriteApi.flush).toHaveBeenCalledTimes(1);
    });

    it('should handle integer fields', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test',
          tags: {},
          fields: { count: 100 },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);
      expect(mockWriteApi.writePoint).toHaveBeenCalled();
    });

    it('should handle float fields', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test',
          tags: {},
          fields: { percentage: 42.5 },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);
      expect(mockWriteApi.writePoint).toHaveBeenCalled();
    });

    it('should handle boolean fields', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test',
          tags: {},
          fields: { enabled: true },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);
      expect(mockWriteApi.writePoint).toHaveBeenCalled();
    });

    it('should handle string fields', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test',
          tags: {},
          fields: { name: 'test value' },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);
      expect(mockWriteApi.writePoint).toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should return true when healthy', async () => {
      const result = await plugin.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should close write API on shutdown', async () => {
      await plugin.shutdown();
      expect(mockWriteApi.close).toHaveBeenCalledTimes(1);
    });
  });
});
