import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimescaleDBPlugin } from '../../../src/plugins/outputs/TimescaleDBPlugin';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockRelease = vi.fn();
const mockClientQuery = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function () {
    return {
      query: mockQuery,
      connect: mockConnect,
      end: mockEnd,
    };
  }),
}));

describe('TimescaleDBPlugin', () => {
  let plugin: TimescaleDBPlugin;
  const testConfig = {
    host: 'localhost',
    port: 5432,
    database: 'varken',
    username: 'varken',
    password: 'secret',
    ssl: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
    mockEnd.mockResolvedValue(undefined);
    plugin = new TimescaleDBPlugin();
  });

  describe('metadata', () => {
    it('exposes correct name, version, and description', () => {
      expect(plugin.metadata.name).toBe('TimescaleDB');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toContain('TimescaleDB');
    });
  });

  describe('initialize', () => {
    it('creates the table, hypertable, and index', async () => {
      await plugin.initialize(testConfig);

      const queries = mockClientQuery.mock.calls.map((c) => c[0] as string);
      expect(queries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS varken_events'))).toBe(true);
      expect(queries.some((q) => q.includes('create_hypertable'))).toBe(true);
      expect(queries.some((q) => q.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
    });

    it('continues past a missing TimescaleDB extension with a warning', async () => {
      mockClientQuery.mockImplementationOnce(() => Promise.resolve({ rows: [] })); // CREATE TABLE
      mockClientQuery.mockImplementationOnce(() => Promise.reject(new Error('extension not installed'))); // create_hypertable
      mockClientQuery.mockImplementationOnce(() => Promise.resolve({ rows: [] })); // CREATE INDEX

      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });

    it('releases the connection after schema setup even on error', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('create table failed'));

      await expect(plugin.initialize(testConfig)).rejects.toThrow('create table failed');
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
      mockQuery.mockClear();
    });

    it('batches points into a single parameterized INSERT', async () => {
      const now = new Date('2026-04-24T00:00:00Z');
      const points: DataPoint[] = [
        { measurement: 'sonarr', tags: { server: 1 }, fields: { queue: 5 }, timestamp: now },
        { measurement: 'radarr', tags: { server: 2 }, fields: { queue: 3 }, timestamp: now },
      ];

      await plugin.write(points);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO varken_events');
      expect(sql).toMatch(/\(\$1, \$2, \$3, \$4\), \(\$5, \$6, \$7, \$8\)/);
      // 2 points × 4 columns = 8 bound params
      expect(values).toHaveLength(8);
      expect(values[1]).toBe('sonarr');
      expect(values[5]).toBe('radarr');
    });

    it('serializes tags/fields as JSON', async () => {
      await plugin.write([
        { measurement: 'm', tags: { host: 'a' }, fields: { v: 1 }, timestamp: new Date() },
      ]);

      const [, values] = mockQuery.mock.calls[0];
      expect(values[2]).toBe('{"host":"a"}');
      expect(values[3]).toBe('{"v":1}');
    });

    it('skips when no points are provided', async () => {
      await plugin.write([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('propagates write errors for the circuit breaker', async () => {
      mockQuery.mockRejectedValueOnce(new Error('db unreachable'));

      await expect(
        plugin.write([
          { measurement: 'm', tags: {}, fields: { v: 1 }, timestamp: new Date() },
        ])
      ).rejects.toThrow('db unreachable');
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('returns true when SELECT 1 succeeds', async () => {
      await expect(plugin.healthCheck()).resolves.toBe(true);
    });

    it('returns false when SELECT 1 throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));
      await expect(plugin.healthCheck()).resolves.toBe(false);
    });
  });

  describe('shutdown', () => {
    it('ends the pool cleanly', async () => {
      await plugin.initialize(testConfig);
      await plugin.shutdown();
      expect(mockEnd).toHaveBeenCalled();
    });

    it('swallows pool.end() errors', async () => {
      await plugin.initialize(testConfig);
      mockEnd.mockRejectedValueOnce(new Error('end failed'));
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });

    it('is safe to call when pool was never initialized', async () => {
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('SSL config', () => {
    it('enables SSL with rejectUnauthorized:false when ssl=true', async () => {
      const { Pool } = await import('pg');
      vi.mocked(Pool).mockClear();

      await plugin.initialize({ ...testConfig, ssl: true });

      const constructorArg = vi.mocked(Pool).mock.calls[0][0];
      expect(constructorArg?.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('omits SSL config when ssl=false', async () => {
      const { Pool } = await import('pg');
      vi.mocked(Pool).mockClear();

      await plugin.initialize(testConfig);

      const constructorArg = vi.mocked(Pool).mock.calls[0][0];
      expect(constructorArg?.ssl).toBeUndefined();
    });
  });
});
