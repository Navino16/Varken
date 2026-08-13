import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestDBPlugin } from '../../../src/plugins/outputs/QuestDBPlugin';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

const mockPost = vi.fn().mockResolvedValue({ status: 204 });
const mockGet = vi.fn().mockResolvedValue({ status: 200 });

vi.mock('../../../src/utils/http', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/http')>(
    '../../../src/utils/http'
  );
  return {
    ...actual,
    createHttpClient: vi.fn(() => ({
      post: mockPost,
      get: mockGet,
    })),
  };
});

describe('QuestDBPlugin', () => {
  let plugin: QuestDBPlugin;
  const testConfig = {
    url: 'localhost',
    port: 9000,
    ssl: false,
    verifySsl: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ status: 204 });
    mockGet.mockResolvedValue({ status: 200 });
    plugin = new QuestDBPlugin();
  });

  describe('metadata', () => {
    it('exposes correct name, version, and description', () => {
      expect(plugin.metadata.name).toBe('QuestDB');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toContain('QuestDB');
    });
  });

  describe('initialize', () => {
    it('initializes cleanly with plain config', async () => {
      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });

    it('initializes with SSL enabled', async () => {
      await expect(
        plugin.initialize({ ...testConfig, ssl: true, verifySsl: true })
      ).resolves.toBeUndefined();
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('POSTs an ILP body to /write for a single point', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'sonarr',
          tags: { host: 'server1' },
          fields: { queue_size: 5 },
          timestamp: new Date('2026-04-24T00:00:00Z'),
        },
      ];

      await plugin.write(points);

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [path, body] = mockPost.mock.calls[0];
      expect(path).toBe('/write');
      expect(body).toContain('sonarr');
      expect(body).toContain('host=server1');
      expect(body).toContain('queue_size=5i');
    });

    it('batches multiple points in a single request', async () => {
      const points: DataPoint[] = [
        { measurement: 'a', tags: {}, fields: { v: 1 }, timestamp: new Date() },
        { measurement: 'b', tags: {}, fields: { v: 2 }, timestamp: new Date() },
      ];

      await plugin.write(points);

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [, body] = mockPost.mock.calls[0];
      expect((body as string).split('\n')).toHaveLength(2);
    });

    it('skips the write when no points are provided', async () => {
      await plugin.write([]);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('propagates write errors for the circuit breaker', async () => {
      mockPost.mockRejectedValueOnce(new Error('connection refused'));
      const points: DataPoint[] = [
        { measurement: 'm', tags: {}, fields: { v: 1 }, timestamp: new Date() },
      ];

      await expect(plugin.write(points)).rejects.toThrow('connection refused');
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('returns true when /exec?query=SELECT 1 responds 200', async () => {
      mockGet.mockResolvedValueOnce({ status: 200 });
      await expect(plugin.healthCheck()).resolves.toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/exec', { params: { query: 'SELECT 1' } });
    });

    it('returns false on non-200 response', async () => {
      mockGet.mockResolvedValueOnce({ status: 503 });
      await expect(plugin.healthCheck()).resolves.toBe(false);
    });

    it('returns false when the request throws', async () => {
      mockGet.mockRejectedValueOnce(new Error('network error'));
      await expect(plugin.healthCheck()).resolves.toBe(false);
    });
  });

  describe('shutdown', () => {
    it('shuts down cleanly', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
