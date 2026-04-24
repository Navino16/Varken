import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { validateEnvironment, type EnvValidationOptions } from '../../src/utils/env';

type FsMock = NonNullable<EnvValidationOptions['fsModule']>;

function makeFsMock(overrides?: {
  existsSync?: ReturnType<typeof vi.fn>;
  mkdirSync?: ReturnType<typeof vi.fn>;
  accessSync?: ReturnType<typeof vi.fn>;
}): FsMock {
  return {
    existsSync: (overrides?.existsSync ?? vi.fn().mockReturnValue(true)) as FsMock['existsSync'],
    mkdirSync: (overrides?.mkdirSync ?? vi.fn()) as FsMock['mkdirSync'],
    accessSync: (overrides?.accessSync ?? vi.fn()) as FsMock['accessSync'],
    constants: fs.constants,
  };
}

describe('validateEnvironment', () => {
  describe('HEALTH_PORT', () => {
    it('accepts a valid port', () => {
      const result = validateEnvironment({ env: { HEALTH_PORT: '9090' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual([]);
    });

    it('rejects a non-numeric port', () => {
      const result = validateEnvironment({ env: { HEALTH_PORT: 'nope' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('HEALTH_PORT="nope"')])
      );
    });

    it('rejects a port out of range', () => {
      const result = validateEnvironment({ env: { HEALTH_PORT: '70000' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('HEALTH_PORT="70000"')])
      );
    });

    it('ignores an empty or missing value', () => {
      expect(validateEnvironment({ env: {}, fsModule: makeFsMock() }).errors).toEqual([]);
      expect(validateEnvironment({ env: { HEALTH_PORT: '' }, fsModule: makeFsMock() }).errors).toEqual([]);
    });
  });

  describe('HEALTH_ENABLED', () => {
    it('accepts "true" and "false" (case-insensitive)', () => {
      expect(validateEnvironment({ env: { HEALTH_ENABLED: 'true' }, fsModule: makeFsMock() }).errors).toEqual([]);
      expect(validateEnvironment({ env: { HEALTH_ENABLED: 'FALSE' }, fsModule: makeFsMock() }).errors).toEqual([]);
    });

    it('rejects any other value', () => {
      const result = validateEnvironment({ env: { HEALTH_ENABLED: 'yes' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('HEALTH_ENABLED="yes"')])
      );
    });
  });

  describe('DRY_RUN', () => {
    it('rejects invalid boolean values', () => {
      const result = validateEnvironment({ env: { DRY_RUN: '1' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('DRY_RUN="1"')])
      );
    });
  });

  describe('LOG_LEVEL', () => {
    it('accepts standard winston levels', () => {
      for (const level of ['error', 'warn', 'info', 'debug']) {
        const result = validateEnvironment({ env: { LOG_LEVEL: level }, fsModule: makeFsMock() });
        expect(result.errors).toEqual([]);
      }
    });

    it('rejects an unknown level', () => {
      const result = validateEnvironment({ env: { LOG_LEVEL: 'chatty' }, fsModule: makeFsMock() });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('LOG_LEVEL="chatty"')])
      );
    });
  });

  describe('directories', () => {
    it('creates missing directories and reports no error', () => {
      const mkdirSync = vi.fn();
      const result = validateEnvironment({
        env: { CONFIG_FOLDER: '/tmp/varken-test-config' },
        fsModule: makeFsMock({ existsSync: vi.fn().mockReturnValue(false), mkdirSync }),
      });
      expect(mkdirSync).toHaveBeenCalled();
      expect(result.errors).toEqual([]);
    });

    it('reports an error if directory cannot be created', () => {
      const result = validateEnvironment({
        env: { DATA_FOLDER: '/root/forbidden' },
        fsModule: makeFsMock({
          existsSync: vi.fn().mockReturnValue(false),
          mkdirSync: vi.fn().mockImplementation(() => {
            throw new Error('EACCES: permission denied');
          }),
        }),
      });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('DATA_FOLDER="/root/forbidden"')])
      );
    });

    it('reports an error if directory is not writable', () => {
      const result = validateEnvironment({
        env: { LOG_FOLDER: '/readonly' },
        fsModule: makeFsMock({
          accessSync: vi.fn().mockImplementation(() => {
            throw new Error('EACCES');
          }),
        }),
      });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('LOG_FOLDER="/readonly"')])
      );
    });
  });

  describe('legacy vars', () => {
    it('warns when VRKN_* variables are present', () => {
      const result = validateEnvironment({
        env: { VRKN_SONARR_1_URL: 'http://localhost:8989' },
        fsModule: makeFsMock(),
      });
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('VRKN_SONARR_1_URL')])
      );
    });

    it('does not warn when no VRKN_* variables are present', () => {
      const result = validateEnvironment({ env: {}, fsModule: makeFsMock() });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('result shape', () => {
    it('always returns errors and warnings arrays', () => {
      const result = validateEnvironment({ env: {}, fsModule: makeFsMock() });
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
