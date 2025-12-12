import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseOutputPlugin, BaseOutputConfig } from '../../../src/plugins/outputs/BaseOutputPlugin';
import { DataPoint, PluginMetadata } from '../../../src/types/plugin.types';

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
interface TestConfig extends BaseOutputConfig {
  customField: string;
}

class TestOutputPlugin extends BaseOutputPlugin<TestConfig> {
  readonly metadata: PluginMetadata = {
    name: 'TestOutput',
    version: '1.0.0',
    description: 'Test output plugin',
  };

  public writtenPoints: DataPoint[] = [];

  async write(points: DataPoint[]): Promise<void> {
    this.writtenPoints.push(...points);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testGetBaseUrl(): string {
    return this.getBaseUrl();
  }

  public testToLineProtocol(point: DataPoint): string {
    return this.toLineProtocol(point);
  }

  public testToLineProtocolBatch(points: DataPoint[]): string {
    return this.toLineProtocolBatch(points);
  }
}

describe('BaseOutputPlugin', () => {
  let plugin: TestOutputPlugin;
  const testConfig: TestConfig = {
    url: 'localhost',
    port: 8086,
    ssl: false,
    verifySsl: false,
    customField: 'custom',
  };

  beforeEach(() => {
    plugin = new TestOutputPlugin();
  });

  describe('initialize', () => {
    it('should initialize with configuration', async () => {
      await plugin.initialize(testConfig);
      expect(plugin.testGetBaseUrl()).toBe('http://localhost:8086');
    });
  });

  describe('getBaseUrl', () => {
    it('should build URL with http and port', async () => {
      await plugin.initialize(testConfig);
      expect(plugin.testGetBaseUrl()).toBe('http://localhost:8086');
    });

    it('should use https when ssl is enabled', async () => {
      await plugin.initialize({ ...testConfig, ssl: true });
      expect(plugin.testGetBaseUrl()).toBe('https://localhost:8086');
    });

    it('should preserve existing http prefix', async () => {
      await plugin.initialize({ ...testConfig, url: 'http://custom.local:9999' });
      expect(plugin.testGetBaseUrl()).toBe('http://custom.local:9999');
    });

    it('should work without port', async () => {
      await plugin.initialize({ ...testConfig, port: undefined });
      expect(plugin.testGetBaseUrl()).toBe('http://localhost');
    });
  });

  describe('toLineProtocol', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should format basic data point', () => {
      const point: DataPoint = {
        measurement: 'test_measurement',
        tags: { server_id: 1, host: 'server1' },
        fields: { value: 42 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('test_measurement');
      expect(result).toContain('server_id=1');
      expect(result).toContain('host=server1');
      expect(result).toContain('value=42i');
      expect(result).toContain('1705314600000000000');
    });

    it('should handle string fields with quotes', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: {},
        fields: { name: 'test value' },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('name="test value"');
    });

    it('should handle boolean fields', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: {},
        fields: { enabled: true, disabled: false },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('enabled=t');
      expect(result).toContain('disabled=f');
    });

    it('should handle float fields', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: {},
        fields: { percentage: 42.5 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('percentage=42.5');
      expect(result).not.toContain('percentage=42.5i');
    });

    it('should escape special characters in measurement', () => {
      const point: DataPoint = {
        measurement: 'test measurement,with=special',
        tags: {},
        fields: { value: 1 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('test\\ measurement\\,with\\=special');
    });

    it('should escape special characters in tags', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: { 'tag key': 'tag,value=here' },
        fields: { value: 1 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('tag\\ key=tag\\,value\\=here');
    });

    it('should escape quotes in string fields', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: {},
        fields: { message: 'He said "hello"' },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('message="He said \\"hello\\""');
    });

    it('should skip null/undefined/empty tag values', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: { valid: 'yes', empty: '' },
        fields: { value: 1 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      expect(result).toContain('valid=yes');
      expect(result).not.toContain('empty=');
    });

    it('should sort tags alphabetically', () => {
      const point: DataPoint = {
        measurement: 'test',
        tags: { zebra: 'z', alpha: 'a', middle: 'm' },
        fields: { value: 1 },
        timestamp: new Date('2024-01-15T10:30:00.000Z'),
      };

      const result = plugin.testToLineProtocol(point);
      const tagsPart = result.split(' ')[0];
      expect(tagsPart).toContain('alpha=a,middle=m,zebra=z');
    });
  });

  describe('toLineProtocolBatch', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should format multiple points separated by newlines', () => {
      const points: DataPoint[] = [
        {
          measurement: 'test1',
          tags: { id: 1 },
          fields: { value: 10 },
          timestamp: new Date('2024-01-15T10:30:00.000Z'),
        },
        {
          measurement: 'test2',
          tags: { id: 2 },
          fields: { value: 20 },
          timestamp: new Date('2024-01-15T10:30:01.000Z'),
        },
      ];

      const result = plugin.testToLineProtocolBatch(points);
      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('test1');
      expect(lines[1]).toContain('test2');
    });
  });

  describe('write', () => {
    it('should store written points', async () => {
      await plugin.initialize(testConfig);
      const points: DataPoint[] = [
        {
          measurement: 'test',
          tags: {},
          fields: { value: 1 },
          timestamp: new Date(),
        },
      ];

      await plugin.write(points);
      expect(plugin.writtenPoints).toHaveLength(1);
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      await plugin.initialize(testConfig);
      const result = await plugin.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
