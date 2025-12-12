import { describe, it, expect } from 'vitest';
import { sha256, generateUniqueId, generateShortId, hashForLogging } from '../../src/utils/hash';

describe('Hash Utilities', () => {
  describe('sha256', () => {
    it('should generate consistent hash for same input', () => {
      const hash1 = sha256('test');
      const hash2 = sha256('test');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = sha256('test1');
      const hash2 = sha256('test2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return 64 character hex string', () => {
      const hash = sha256('test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should handle empty string', () => {
      const hash = sha256('');
      expect(hash).toHaveLength(64);
    });

    it('should handle unicode characters', () => {
      const hash = sha256('héllo wörld 🎉');
      expect(hash).toHaveLength(64);
    });
  });

  describe('generateUniqueId', () => {
    it('should generate consistent ID for same values', () => {
      const id1 = generateUniqueId('sonarr', 1, 'queue');
      const id2 = generateUniqueId('sonarr', 1, 'queue');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different values', () => {
      const id1 = generateUniqueId('sonarr', 1, 'queue');
      const id2 = generateUniqueId('sonarr', 2, 'queue');
      expect(id1).not.toBe(id2);
    });

    it('should handle mixed types', () => {
      const id = generateUniqueId('string', 123, true, null, undefined);
      expect(id).toHaveLength(64);
    });

    it('should handle null and undefined', () => {
      const id1 = generateUniqueId(null, undefined);
      const id2 = generateUniqueId('', '');
      expect(id1).toBe(id2);
    });

    it('should be order-sensitive', () => {
      const id1 = generateUniqueId('a', 'b');
      const id2 = generateUniqueId('b', 'a');
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateShortId', () => {
    it('should return 16 character string', () => {
      const id = generateShortId('test', 123);
      expect(id).toHaveLength(16);
    });

    it('should be consistent for same values', () => {
      const id1 = generateShortId('test', 123);
      const id2 = generateShortId('test', 123);
      expect(id1).toBe(id2);
    });

    it('should be prefix of full unique ID', () => {
      const shortId = generateShortId('test', 123);
      const fullId = generateUniqueId('test', 123);
      expect(fullId.startsWith(shortId)).toBe(true);
    });
  });

  describe('hashForLogging', () => {
    it('should return masked hash', () => {
      const result = hashForLogging('my-secret-key');
      expect(result).toMatch(/^\*\*\*[a-f0-9]{8}$/);
    });

    it('should return [empty] for empty string', () => {
      expect(hashForLogging('')).toBe('[empty]');
    });

    it('should be consistent for same input', () => {
      const result1 = hashForLogging('secret');
      const result2 = hashForLogging('secret');
      expect(result1).toBe(result2);
    });

    it('should produce different results for different inputs', () => {
      const result1 = hashForLogging('secret1');
      const result2 = hashForLogging('secret2');
      expect(result1).not.toBe(result2);
    });
  });
});
