import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { HealthServer, HealthServerConfig } from '../../src/core/HealthServer';
import { PluginManager } from '../../src/core/PluginManager';
import type { SchedulerStatus, PluginStatus } from '../../src/types/health.types';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Helper to make HTTP GET requests
 */
function httpGet(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Create a mock PluginManager
 */
function createMockPluginManager(overrides: {
  healthCheck?: Map<string, boolean>;
  schedulerStatuses?: SchedulerStatus[];
  inputPluginStatuses?: PluginStatus[];
  outputPluginStatuses?: PluginStatus[];
  stats?: {
    registeredInputTypes: number;
    registeredOutputTypes: number;
    activeInputPlugins: number;
    activeOutputPlugins: number;
    activeSchedulers: number;
  };
} = {}): PluginManager {
  const defaultHealthCheck = new Map([['influxdb2', true]]);
  const defaultStats = {
    registeredInputTypes: 1,
    registeredOutputTypes: 1,
    activeInputPlugins: 1,
    activeOutputPlugins: 1,
    activeSchedulers: 2,
  };
  const defaultSchedulerStatuses: SchedulerStatus[] = [
    {
      name: 'sonarr_1_queue',
      pluginName: 'Sonarr',
      intervalSeconds: 30,
      isRunning: false,
      lastRunAt: new Date(),
      consecutiveErrors: 0,
    },
  ];
  const defaultInputStatuses: PluginStatus[] = [
    { type: 'sonarr', name: 'Sonarr', version: '1.0.0', healthy: true },
  ];
  const defaultOutputStatuses: PluginStatus[] = [
    { type: 'influxdb2', name: 'InfluxDB2', version: '1.0.0', healthy: true },
  ];

  return {
    healthCheck: vi.fn().mockResolvedValue(overrides.healthCheck ?? defaultHealthCheck),
    getSchedulerStatuses: vi.fn().mockReturnValue(overrides.schedulerStatuses ?? defaultSchedulerStatuses),
    getInputPluginStatuses: vi.fn().mockResolvedValue(overrides.inputPluginStatuses ?? defaultInputStatuses),
    getOutputPluginStatuses: vi.fn().mockResolvedValue(overrides.outputPluginStatuses ?? defaultOutputStatuses),
    getStats: vi.fn().mockReturnValue(overrides.stats ?? defaultStats),
  } as unknown as PluginManager;
}

describe('HealthServer', () => {
  let healthServer: HealthServer;
  let testPort: number;

  const config: HealthServerConfig = {
    port: 0, // Will be overridden
    version: '2.0.0',
  };

  beforeEach(() => {
    // Use a random port for each test to avoid conflicts
    testPort = 19090 + Math.floor(Math.random() * 1000);
    config.port = testPort;
    healthServer = new HealthServer(config);
  });

  afterEach(async () => {
    await healthServer.stop();
  });

  describe('start', () => {
    it('should start the server', async () => {
      await healthServer.start();
      const response = await httpGet(testPort, '/health');
      expect(response.statusCode).toBeDefined();
    });

    it('should reject if port is in use', async () => {
      await healthServer.start();

      const secondServer = new HealthServer(config);
      await expect(secondServer.start()).rejects.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop the server', async () => {
      await healthServer.start();
      await healthServer.stop();

      // Server should be stopped, request should fail
      await expect(httpGet(testPort, '/health')).rejects.toThrow();
    });

    it('should do nothing if not started', async () => {
      await healthServer.stop(); // Should not throw
    });
  });

  describe('GET /health', () => {
    it('should return healthy status when all plugins are healthy', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.version).toBe('2.0.0');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.timestamp).toBeDefined();
    });

    it('should return degraded status when some outputs are unhealthy', async () => {
      const mockPm = createMockPluginManager({
        healthCheck: new Map([['influxdb2', false], ['influxdb1', true]]),
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('degraded');
    });

    it('should return degraded status when some schedulers have errors', async () => {
      const mockPm = createMockPluginManager({
        schedulerStatuses: [
          { name: 'sonarr_1_queue', pluginName: 'Sonarr', intervalSeconds: 30, isRunning: false, consecutiveErrors: 5 },
          { name: 'radarr_1_queue', pluginName: 'Radarr', intervalSeconds: 30, isRunning: false, consecutiveErrors: 0 },
        ],
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('degraded');
    });

    it('should return unhealthy status when no plugin manager is set', async () => {
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('unhealthy');
    });

    it('should return unhealthy status when no outputs are configured', async () => {
      const mockPm = createMockPluginManager({
        healthCheck: new Map(),
        schedulerStatuses: [],
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('unhealthy');
    });

    it('should return unhealthy status when all outputs are unhealthy', async () => {
      const mockPm = createMockPluginManager({
        healthCheck: new Map([['influxdb2', false]]),
        schedulerStatuses: [
          { name: 'sonarr_1_queue', pluginName: 'Sonarr', intervalSeconds: 30, isRunning: false, consecutiveErrors: 5 },
        ],
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('unhealthy');
    });
  });

  describe('GET /health/plugins', () => {
    it('should return plugin statuses', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health/plugins');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.inputs).toHaveLength(1);
      expect(body.outputs).toHaveLength(1);
      expect(body.inputs[0].type).toBe('sonarr');
      expect(body.outputs[0].type).toBe('influxdb2');
    });

    it('should return 503 when plugin manager is not set', async () => {
      await healthServer.start();

      const response = await httpGet(testPort, '/health/plugins');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.error).toBe('Plugin manager not initialized');
    });

    it('should show unhealthy plugins', async () => {
      const mockPm = createMockPluginManager({
        outputPluginStatuses: [
          { type: 'influxdb2', name: 'InfluxDB2', version: '1.0.0', healthy: false, error: 'Connection refused' },
        ],
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/health/plugins');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.outputs[0].healthy).toBe(false);
      expect(body.outputs[0].error).toBe('Connection refused');
    });
  });

  describe('GET /status', () => {
    it('should return detailed status', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/status');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.version).toBe('2.0.0');
      expect(body.stats).toBeDefined();
      expect(body.stats.activeInputPlugins).toBe(1);
      expect(body.stats.activeOutputPlugins).toBe(1);
      expect(body.stats.activeSchedulers).toBe(2);
      expect(body.schedulers).toHaveLength(1);
    });

    it('should return 503 when plugin manager is not set', async () => {
      await healthServer.start();

      const response = await httpGet(testPort, '/status');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.error).toBe('Plugin manager not initialized');
    });

    it('should include scheduler error information', async () => {
      const mockPm = createMockPluginManager({
        schedulerStatuses: [
          {
            name: 'sonarr_1_queue',
            pluginName: 'Sonarr',
            intervalSeconds: 30,
            isRunning: false,
            lastRunAt: new Date(),
            lastError: 'Connection refused',
            consecutiveErrors: 3,
          },
        ],
      });
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/status');
      const body = JSON.parse(response.body);

      expect(body.schedulers[0].lastError).toBe('Connection refused');
      expect(body.schedulers[0].consecutiveErrors).toBe(3);
    });
  });

  describe('Invalid routes', () => {
    it('should return 404 for unknown routes', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await httpGet(testPort, '/unknown');
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toBe('Not Found');
    });
  });

  describe('Invalid methods', () => {
    it('should return 405 for non-GET methods', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      // Make a POST request
      const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: testPort,
            path: '/health',
            method: 'POST',
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ statusCode: res.statusCode || 500, body }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(405);
      expect(body.error).toBe('Method Not Allowed');
    });
  });

  describe('CORS headers', () => {
    it('should set CORS and content-type headers', async () => {
      const mockPm = createMockPluginManager();
      healthServer.setPluginManager(mockPm);
      await healthServer.start();

      const response = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}/health`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ headers: res.headers }));
        });
        req.on('error', reject);
      });

      expect(response.headers['content-type']).toBe('application/json');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });
});
