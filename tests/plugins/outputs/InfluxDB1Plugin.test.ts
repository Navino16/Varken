import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfluxDB1Plugin } from '../../../src/plugins/outputs/InfluxDB1Plugin';
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

// Create mock functions that can be controlled per-test
const mockPing = vi.fn().mockResolvedValue([{ online: true }]);
const mockGetDatabaseNames = vi.fn().mockResolvedValue(['varken']);
const mockCreateDatabase = vi.fn().mockResolvedValue(undefined);
const mockWritePoints = vi.fn().mockResolvedValue(undefined);

// Mock the influx package
vi.mock('influx', () => ({
  InfluxDB: vi.fn().mockImplementation(() => ({
    getDatabaseNames: mockGetDatabaseNames,
    createDatabase: mockCreateDatabase,
    writePoints: mockWritePoints,
    ping: mockPing,
  })),
  FieldType: {
    BOOLEAN: 'BOOLEAN',
    INTEGER: 'INTEGER',
    FLOAT: 'FLOAT',
    STRING: 'STRING',
  },
}));

describe('InfluxDB1Plugin', () => {
  let plugin: InfluxDB1Plugin;
  const testConfig = {
    url: 'localhost',
    port: 8086,
    username: 'root',
    password: 'root',
    database: 'varken',
    ssl: false,
    verifySsl: false,
  };

  beforeEach(() => {
    plugin = new InfluxDB1Plugin();
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('InfluxDB1');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });

    it('should handle SSL configuration', async () => {
      const sslConfig = { ...testConfig, ssl: true, verifySsl: false };
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

      await expect(plugin.write(points)).resolves.toBeUndefined();
    });

    it('should handle empty points array', async () => {
      await expect(plugin.write([])).resolves.toBeUndefined();
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

      await expect(plugin.write(points)).resolves.toBeUndefined();
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

      await expect(plugin.write(points)).resolves.toBeUndefined();
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

      await expect(plugin.write(points)).resolves.toBeUndefined();
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

      await expect(plugin.write(points)).resolves.toBeUndefined();
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

    it('should return false when host is offline', async () => {
      mockPing.mockResolvedValueOnce([{ online: false }]);

      const result = await plugin.healthCheck();
      expect(result).toBe(false);
    });

    it('should return false when ping throws', async () => {
      mockPing.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await plugin.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should shutdown without error', async () => {
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
