import { describe, it, expect } from 'vitest';
import {
  GeoIPHandler,
  createGeoIPHandler,
  createHttpClient,
  formatHttpError,
  isHttpStatus,
  isClientError,
  isServerError,
  isNetworkError,
  extractResponseData,
  withTimeout,
} from '../../src/utils';

describe('Utils Index', () => {
  describe('GeoIP exports', () => {
    it('should export GeoIPHandler', () => {
      expect(GeoIPHandler).toBeDefined();
      expect(typeof GeoIPHandler).toBe('function');
    });

    it('should export createGeoIPHandler', () => {
      expect(createGeoIPHandler).toBeDefined();
      expect(typeof createGeoIPHandler).toBe('function');
    });
  });

  describe('HTTP exports', () => {
    it('should export createHttpClient', () => {
      expect(createHttpClient).toBeDefined();
      expect(typeof createHttpClient).toBe('function');
    });

    it('should export formatHttpError', () => {
      expect(formatHttpError).toBeDefined();
      expect(typeof formatHttpError).toBe('function');
    });

    it('should export isHttpStatus', () => {
      expect(isHttpStatus).toBeDefined();
      expect(typeof isHttpStatus).toBe('function');
    });

    it('should export isClientError', () => {
      expect(isClientError).toBeDefined();
      expect(typeof isClientError).toBe('function');
    });

    it('should export isServerError', () => {
      expect(isServerError).toBeDefined();
      expect(typeof isServerError).toBe('function');
    });

    it('should export isNetworkError', () => {
      expect(isNetworkError).toBeDefined();
      expect(typeof isNetworkError).toBe('function');
    });

    it('should export extractResponseData', () => {
      expect(extractResponseData).toBeDefined();
      expect(typeof extractResponseData).toBe('function');
    });

    it('should export withTimeout', () => {
      expect(withTimeout).toBeDefined();
      expect(typeof withTimeout).toBe('function');
    });
  });
});
