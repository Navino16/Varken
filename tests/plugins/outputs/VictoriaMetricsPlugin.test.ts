import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VictoriaMetricsPlugin } from '../../../src/plugins/outputs/VictoriaMetricsPlugin';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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

describe('VictoriaMetricsPlugin', () => {
  let plugin: VictoriaMetricsPlugin;
  const testConfig = {
    url: 'localhost',
    port: 8428,
    ssl: false,
    verifySsl: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ status: 204 });
    mockGet.mockResolvedValue({ status: 200 });
    plugin = new VictoriaMetricsPlugin();
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('VictoriaMetrics');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toContain('VictoriaMetrics');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with plain config', async () => {
      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });

    it('should initialize with SSL enabled', async () => {
      await expect(
        plugin.initialize({ ...testConfig, ssl: true, verifySsl: true })
      ).resolves.toBeUndefined();
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should POST line protocol payload for a single point', async () => {
      const points: DataPoint[] = [
        {
          measurement: 'test_measurement',
          tags: { host: 'server1' },
          fields: { value: 42 },
          timestamp: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      await plugin.write(points);

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [path, body] = mockPost.mock.calls[0];
      expect(path).toBe('/write');
      expect(body).toContain('test_measurement');
      expect(body).toContain('host=server1');
      expect(body).toContain('value=42i');
    });

    it('should batch multiple points in a single request', async () => {
      const points: DataPoint[] = [
        { measurement: 'm1', tags: {}, fields: { v: 1 }, timestamp: new Date() },
        { measurement: 'm2', tags: {}, fields: { v: 2 }, timestamp: new Date() },
      ];

      await plugin.write(points);

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [, body] = mockPost.mock.calls[0];
      expect((body as string).split('\n')).toHaveLength(2);
    });

    it('should skip write when no points are provided', async () => {
      await plugin.write([]);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should propagate write errors', async () => {
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

    it('should return true when /health returns 200', async () => {
      mockGet.mockResolvedValueOnce({ status: 200 });
      await expect(plugin.healthCheck()).resolves.toBe(true);
    });

    it('should return false when /health returns non-200', async () => {
      mockGet.mockResolvedValueOnce({ status: 503 });
      await expect(plugin.healthCheck()).resolves.toBe(false);
    });

    it('should return false when /health throws', async () => {
      mockGet.mockRejectedValueOnce(new Error('network error'));
      await expect(plugin.healthCheck()).resolves.toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
