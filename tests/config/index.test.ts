import { describe, it, expect } from 'vitest';
import { ConfigLoader, ConfigMigrator } from '../../src/config';
import { GlobalConfigSchema } from '../../src/config/schemas/config.schema';

describe('Config Index', () => {
  describe('exports', () => {
    it('should export ConfigLoader', () => {
      expect(ConfigLoader).toBeDefined();
      expect(typeof ConfigLoader).toBe('function');
    });

    it('should export ConfigMigrator', () => {
      expect(ConfigMigrator).toBeDefined();
      expect(typeof ConfigMigrator).toBe('function');
    });
  });
});

describe('GlobalConfigSchema cacheTtlSeconds', () => {
  it('accepts a non-negative cacheTtlSeconds', () => {
    const parsed = GlobalConfigSchema.parse({ cacheTtlSeconds: 30 });
    expect(parsed.cacheTtlSeconds).toBe(30);
  });

  it('leaves cacheTtlSeconds undefined when omitted', () => {
    const parsed = GlobalConfigSchema.parse({});
    expect(parsed.cacheTtlSeconds).toBeUndefined();
  });

  it('rejects a negative cacheTtlSeconds', () => {
    expect(() => GlobalConfigSchema.parse({ cacheTtlSeconds: -1 })).toThrow();
  });
});
