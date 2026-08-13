import { describe, it, expect } from 'vitest';
import { VarkenConfigSchema } from '../../src/config/schemas/config.schema';
import {
  createMockHttpClient,
  createMockAxios,
  createMockVarkenConfig,
  createMockGlobalConfig,
  loggerMock,
} from './index';

describe('test fixtures', () => {
  describe('createMockHttpClient', () => {
    it('returns an axios-like client with fresh spies per invocation', () => {
      const a = createMockHttpClient();
      const b = createMockHttpClient();

      expect(a.get).not.toBe(b.get);
      expect(a.post).not.toBe(b.post);
      expect(a.defaults.headers.common).toEqual({});
      expect(typeof a.interceptors.request.use).toBe('function');
    });
  });

  describe('createMockAxios', () => {
    it('wraps a client and exposes default.create()', () => {
      const client = createMockHttpClient();
      const axios = createMockAxios(client);

      expect(axios.default.create).toBeDefined();
      expect(axios.default.create()).toBe(client);
    });
  });

  describe('createMockVarkenConfig', () => {
    it('returns a config that passes schema validation as-is', () => {
      const config = createMockVarkenConfig();
      const result = VarkenConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('applies top-level overrides', () => {
      const config = createMockVarkenConfig({
        outputs: {
          influxdb2: {
            url: 'localhost',
            port: 8086,
            token: 't',
            org: 'o',
            bucket: 'b',
            ssl: false,
            verifySsl: false,
          },
        },
      });
      expect(config.outputs.influxdb2).toBeDefined();
      expect(config.outputs.influxdb1).toBeUndefined();
    });
  });

  describe('createMockGlobalConfig', () => {
    it('uses production-like defaults', () => {
      const g = createMockGlobalConfig();
      expect(g.httpTimeoutMs).toBe(30000);
      expect(g.collectorTimeoutMs).toBe(60000);
    });

    it('accepts partial overrides', () => {
      const g = createMockGlobalConfig({ httpTimeoutMs: 1000 });
      expect(g.httpTimeoutMs).toBe(1000);
      expect(g.healthCheckTimeoutMs).toBe(5000);
    });
  });

  describe('loggerMock', () => {
    it('exposes createLogger with info/debug/warn/error spies', () => {
      const mock = loggerMock();
      const logger = mock.createLogger();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('withContext returns the logger unchanged (pass-through)', () => {
      const mock = loggerMock();
      const logger = mock.createLogger();
      expect(mock.withContext(logger, { pluginId: 1 })).toBe(logger);
    });
  });
});
