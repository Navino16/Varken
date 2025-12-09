import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import {
  createHttpClient,
  formatHttpError,
  isHttpStatus,
  isClientError,
  isServerError,
  isNetworkError,
  withTimeout,
} from '../../src/utils/http';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('HTTP Utilities', () => {
  describe('createHttpClient', () => {
    it('should create an axios instance with baseURL', () => {
      const client = createHttpClient({
        baseURL: 'http://localhost:8080',
      });
      expect(client.defaults.baseURL).toBe('http://localhost:8080');
    });

    it('should set custom timeout', () => {
      const client = createHttpClient({
        baseURL: 'http://localhost:8080',
        timeout: 5000,
      });
      expect(client.defaults.timeout).toBe(5000);
    });

    it('should set default timeout of 30000', () => {
      const client = createHttpClient({
        baseURL: 'http://localhost:8080',
      });
      expect(client.defaults.timeout).toBe(30000);
    });

    it('should set custom headers', () => {
      const client = createHttpClient({
        baseURL: 'http://localhost:8080',
        headers: { 'X-Api-Key': 'test-key' },
      });
      expect(client.defaults.headers['X-Api-Key']).toBe('test-key');
    });

    it('should configure https agent for verifySsl=false', () => {
      const client = createHttpClient({
        baseURL: 'https://localhost:8080',
        verifySsl: false,
      });
      expect(client.defaults.httpsAgent).toBeDefined();
    });
  });

  describe('formatHttpError', () => {
    it('should format non-axios error', () => {
      const error = new Error('Generic error');
      expect(formatHttpError(error)).toBe('Generic error');
    });

    it('should format unknown error type', () => {
      expect(formatHttpError('string error')).toBe('Unknown error');
    });

    it('should format axios error with response', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 404,
          statusText: 'Not Found',
          data: {},
        },
        config: {
          url: '/api/test',
        },
      } as AxiosError;

      // Mock axios.isAxiosError
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = formatHttpError(error);
      expect(result).toContain('404');
      expect(result).toContain('Not Found');
    });

    it('should format axios error without response (network error)', () => {
      const error = {
        isAxiosError: true,
        request: {},
        code: 'ECONNREFUSED',
        config: {
          url: '/api/test',
        },
      } as unknown as AxiosError;

      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = formatHttpError(error);
      expect(result).toContain('Connection refused');
    });

    it('should format axios timeout error', () => {
      const error = {
        isAxiosError: true,
        request: {},
        code: 'ETIMEDOUT',
        config: {
          url: '/api/test',
        },
      } as unknown as AxiosError;

      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = formatHttpError(error);
      expect(result).toContain('timed out');
    });
  });

  describe('isHttpStatus', () => {
    beforeEach(() => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true for matching status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 404 },
      } as AxiosError;

      expect(isHttpStatus(error, 404)).toBe(true);
    });

    it('should return false for non-matching status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 500 },
      } as AxiosError;

      expect(isHttpStatus(error, 404)).toBe(false);
    });

    it('should return false for non-axios error', () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(isHttpStatus(new Error('test'), 404)).toBe(false);
    });
  });

  describe('isClientError', () => {
    beforeEach(() => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true for 4xx status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 400 },
      } as AxiosError;

      expect(isClientError(error)).toBe(true);
    });

    it('should return true for 404', () => {
      const error = {
        isAxiosError: true,
        response: { status: 404 },
      } as AxiosError;

      expect(isClientError(error)).toBe(true);
    });

    it('should return false for 5xx status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 500 },
      } as AxiosError;

      expect(isClientError(error)).toBe(false);
    });

    it('should return false for non-axios error', () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(isClientError(new Error('test'))).toBe(false);
    });
  });

  describe('isServerError', () => {
    beforeEach(() => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true for 5xx status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 500 },
      } as AxiosError;

      expect(isServerError(error)).toBe(true);
    });

    it('should return true for 503', () => {
      const error = {
        isAxiosError: true,
        response: { status: 503 },
      } as AxiosError;

      expect(isServerError(error)).toBe(true);
    });

    it('should return false for 4xx status', () => {
      const error = {
        isAxiosError: true,
        response: { status: 400 },
      } as AxiosError;

      expect(isServerError(error)).toBe(false);
    });

    it('should return false for non-axios error', () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(isServerError(new Error('test'))).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    beforeEach(() => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true when no response but request exists', () => {
      const error = {
        isAxiosError: true,
        request: {},
        response: undefined,
      } as AxiosError;

      expect(isNetworkError(error)).toBe(true);
    });

    it('should return false when response exists', () => {
      const error = {
        isAxiosError: true,
        request: {},
        response: { status: 500 },
      } as AxiosError;

      expect(isNetworkError(error)).toBe(false);
    });

    it('should return false for non-axios error', () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(isNetworkError(new Error('test'))).toBe(false);
    });
  });

  describe('withTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve if promise completes before timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await withTimeout(promise, 1000);
      expect(result).toBe('success');
    });

    it('should reject with timeout error if promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('success'), 2000);
      });

      const timeoutPromise = withTimeout(slowPromise, 100);

      // Advance time past the timeout
      vi.advanceTimersByTime(150);

      await expect(timeoutPromise).rejects.toThrow('Operation timed out');
    });

    it('should use custom timeout message', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('success'), 2000);
      });

      const timeoutPromise = withTimeout(slowPromise, 100, 'Custom timeout message');

      vi.advanceTimersByTime(150);

      await expect(timeoutPromise).rejects.toThrow('Custom timeout message');
    });

    it('should propagate errors from the original promise', async () => {
      const failingPromise = Promise.reject(new Error('Original error'));

      await expect(withTimeout(failingPromise, 1000)).rejects.toThrow('Original error');
    });
  });
});
