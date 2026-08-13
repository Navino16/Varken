import { describe, it, expect } from 'vitest';
import { explainError, formatHelpfulError } from '../../src/utils/errors';

interface AxiosErrorShape {
  isAxiosError: true;
  message: string;
  config?: { url?: string };
  code?: string;
  request?: unknown;
  response?: {
    status: number;
    statusText: string;
    data?: unknown;
  };
}

function axiosNetworkError(code: string, url = '/api/v3/queue'): AxiosErrorShape {
  return {
    isAxiosError: true,
    message: `Network failure: ${code}`,
    config: { url },
    code,
    request: {},
  };
}

function axiosResponseError(
  status: number,
  statusText: string,
  data?: unknown,
  url = '/api/v3/queue'
): AxiosErrorShape {
  return {
    isAxiosError: true,
    message: `HTTP ${status}`,
    config: { url },
    response: { status, statusText, data },
  };
}

describe('explainError', () => {
  describe('plain errors', () => {
    it('returns the raw message for a regular Error with no hint', () => {
      const exp = explainError(new Error('boom'));
      expect(exp.message).toBe('boom');
      expect(exp.hint).toBeNull();
    });

    it('stringifies non-Error values', () => {
      expect(explainError('weird').message).toBe('weird');
      expect(explainError(42).message).toBe('42');
    });
  });

  describe('network errors', () => {
    it('explains ECONNREFUSED with a reachability hint', () => {
      const exp = explainError(axiosNetworkError('ECONNREFUSED'), { service: 'Sonarr' });
      expect(exp.message).toContain('Connection refused');
      expect(exp.message).toContain('Sonarr');
      expect(exp.hint).toMatch(/Sonarr is running/);
    });

    it('explains ETIMEDOUT with a timeout-tuning hint', () => {
      const exp = explainError(axiosNetworkError('ETIMEDOUT'), { service: 'Radarr' });
      expect(exp.message).toContain('timed out');
      expect(exp.hint).toMatch(/httpTimeoutMs/);
    });

    it('explains ECONNABORTED the same way as ETIMEDOUT', () => {
      const exp = explainError(axiosNetworkError('ECONNABORTED'));
      expect(exp.message).toContain('timed out');
      expect(exp.hint).toMatch(/httpTimeoutMs/);
    });

    it('explains ENOTFOUND with a DNS hint', () => {
      const exp = explainError(axiosNetworkError('ENOTFOUND'));
      expect(exp.message).toContain('Host not found');
      expect(exp.hint).toMatch(/DNS/);
    });

    it('explains TLS certificate errors', () => {
      const exp = explainError(axiosNetworkError('CERT_HAS_EXPIRED'));
      expect(exp.message).toContain('TLS certificate error');
      expect(exp.hint).toMatch(/verifySsl/);
    });

    it('falls back to a generic no-response message for unknown codes', () => {
      const exp = explainError(axiosNetworkError('EHOSTUNREACH'));
      expect(exp.message).toContain('No response');
      expect(exp.hint).toMatch(/network is reachable/);
    });
  });

  describe('HTTP status errors', () => {
    it('suggests checking the API key for 401 when authType is apiKey (default)', () => {
      const exp = explainError(axiosResponseError(401, 'Unauthorized'));
      expect(exp.hint).toMatch(/API key/);
    });

    it('suggests checking the token for 401 when authType is token', () => {
      const exp = explainError(axiosResponseError(403, 'Forbidden'), { authType: 'token' });
      expect(exp.hint).toMatch(/token/);
    });

    it('suggests path/version check for 404', () => {
      const exp = explainError(axiosResponseError(404, 'Not Found'));
      expect(exp.hint).toMatch(/API path/);
    });

    it('explains rate limiting for 429', () => {
      const exp = explainError(axiosResponseError(429, 'Too Many Requests'));
      expect(exp.hint).toMatch(/Rate limited/);
    });

    it('suggests checking server logs for 5xx', () => {
      const exp = explainError(axiosResponseError(502, 'Bad Gateway'));
      expect(exp.hint).toMatch(/server error/);
    });

    it('returns no hint for unhandled status codes', () => {
      const exp = explainError(axiosResponseError(418, "I'm a teapot"));
      expect(exp.hint).toBeNull();
    });
  });

  describe('response body handling', () => {
    it('extracts error.message from JSON body', () => {
      const exp = explainError(axiosResponseError(400, 'Bad Request', { message: 'field required' }));
      expect(exp.detail).toBe('field required');
    });

    it('extracts error.error from JSON body', () => {
      const exp = explainError(axiosResponseError(500, 'Server Error', { error: 'internal boom' }));
      expect(exp.detail).toBe('internal boom');
    });

    it('detects HTML responses and overrides the hint', () => {
      const html = '<!DOCTYPE html><html><body>Login</body></html>';
      const exp = explainError(axiosResponseError(200, 'OK', html));
      expect(exp.hint).toMatch(/HTML instead of JSON/);
    });

    it('truncates very long string bodies', () => {
      const longBody = 'x'.repeat(500);
      const exp = explainError(axiosResponseError(400, 'Bad', longBody));
      expect(exp.detail?.length).toBeLessThanOrEqual(301);
      expect(exp.detail?.endsWith('…')).toBe(true);
    });
  });

  describe('format()', () => {
    it('combines message, hint and docs into a single line', () => {
      const exp = explainError(axiosNetworkError('ECONNREFUSED'), { service: 'Sonarr' });
      const line = exp.format();
      expect(line).toContain('Connection refused');
      expect(line).toContain('Hint:');
      expect(line).toContain('See:');
    });

    it('omits the hint section when absent', () => {
      const exp = explainError(new Error('plain'));
      expect(exp.format()).not.toContain('Hint:');
    });
  });

  describe('formatHelpfulError shorthand', () => {
    it('delegates to explainError().format()', () => {
      const err = axiosNetworkError('ECONNREFUSED');
      expect(formatHelpfulError(err, { service: 'Sonarr' })).toBe(
        explainError(err, { service: 'Sonarr' }).format()
      );
    });
  });
});
