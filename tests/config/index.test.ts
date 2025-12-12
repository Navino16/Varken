import { describe, it, expect } from 'vitest';
import { ConfigLoader, ConfigMigrator } from '../../src/config';

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
