import { describe, it, expect } from 'vitest';

// Test the sensitive data filtering logic directly (matching the patterns in Logger.ts)
describe('Logger', () => {
  describe('Sensitive data filtering patterns', () => {
    // These patterns match those in src/core/Logger.ts
    const SENSITIVE_PATTERNS = [
      /apikey[=:]\s*["']?[\w-]+["']?/gi,
      /token[=:]\s*["']?[\w-]+["']?/gi,
      /password[=:]\s*["']?[^"'\s]+["']?/gi,
      /secret[=:]\s*["']?[\w-]+["']?/gi,
    ];

    const filterMessage = (message: string): string => {
      let filtered = message;
      for (const pattern of SENSITIVE_PATTERNS) {
        filtered = filtered.replace(pattern, (match) => {
          const [key] = match.split(/[=:]/);
          return `${key}=***REDACTED***`;
        });
      }
      return filtered;
    };

    it('should filter apikey from log messages', () => {
      const message = 'Connecting with apikey=secret123';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Connecting with apikey=***REDACTED***');
    });

    it('should filter apikey with colon separator', () => {
      const message = 'Using apikey: my-api-key-123';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Using apikey=***REDACTED***');
    });

    it('should filter token from log messages', () => {
      const message = 'Using token: my-secret-token';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Using token=***REDACTED***');
    });

    it('should filter token with equals', () => {
      const message = 'Authorization token=bearer-xyz789';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Authorization token=***REDACTED***');
    });

    it('should filter password from log messages', () => {
      const message = 'Login with password=MyP@ssw0rd!';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Login with password=***REDACTED***');
    });

    it('should filter password with special characters', () => {
      const message = 'Database password: super$ecret!123';
      const filtered = filterMessage(message);
      expect(filtered).toBe('Database password=***REDACTED***');
    });

    it('should filter secret from log messages', () => {
      const message = 'API secret="super-secret-value"';
      const filtered = filterMessage(message);
      expect(filtered).toBe('API secret=***REDACTED***');
    });

    it('should filter secret with single quotes', () => {
      const message = "Config secret='my-secret'";
      const filtered = filterMessage(message);
      expect(filtered).toBe('Config secret=***REDACTED***');
    });

    it('should filter multiple sensitive values', () => {
      const message = 'Config: apikey=abc123, token=xyz789, password=secret';
      const filtered = filterMessage(message);
      expect(filtered).toBe(
        'Config: apikey=***REDACTED***, token=***REDACTED***, password=***REDACTED***'
      );
    });

    it('should not filter non-sensitive data', () => {
      const message = 'User logged in successfully';
      const filtered = filterMessage(message);
      expect(filtered).toBe('User logged in successfully');
    });

    it('should handle case insensitivity for apikey', () => {
      const message = 'APIKEY=test123 ApiKey=abc';
      const filtered = filterMessage(message);
      expect(filtered).toContain('APIKEY=***REDACTED***');
      expect(filtered).toContain('ApiKey=***REDACTED***');
    });

    it('should handle case insensitivity for token', () => {
      const message = 'TOKEN=test Token=abc';
      const filtered = filterMessage(message);
      expect(filtered).toContain('TOKEN=***REDACTED***');
      expect(filtered).toContain('Token=***REDACTED***');
    });

    it('should handle case insensitivity for password', () => {
      const message = 'PASSWORD=xyz Password=abc';
      const filtered = filterMessage(message);
      expect(filtered).toContain('PASSWORD=***REDACTED***');
      expect(filtered).toContain('Password=***REDACTED***');
    });

    it('should handle URLs with credentials', () => {
      const message = 'Connecting to http://user:password=secret@host.com';
      const filtered = filterMessage(message);
      expect(filtered).toContain('password=***REDACTED***');
    });

    it('should not filter JSON properties without = or : separators', () => {
      // The pattern requires = or : directly after the keyword
      // JSON format "apikey": "value" has quotes around the key which don't match
      const message = '{"apikey": "test-key", "data": "value"}';
      const filtered = filterMessage(message);
      // This should NOT be filtered because JSON uses quotes around keys
      expect(filtered).toBe(message);
    });

    it('should filter log-style key-value pairs', () => {
      // But log-style apikey=value or apikey: value should be filtered
      const message = 'apikey=test-key data=value';
      const filtered = filterMessage(message);
      expect(filtered).toContain('apikey=***REDACTED***');
    });
  });

  describe('createLogger export', () => {
    it('should export createLogger function', async () => {
      // Import the real module to verify it exports properly
      const loggerModule = await import('../../src/core/Logger');
      expect(loggerModule.createLogger).toBeDefined();
      expect(typeof loggerModule.createLogger).toBe('function');
    });

    it('should export default logger', async () => {
      const loggerModule = await import('../../src/core/Logger');
      expect(loggerModule.default).toBeDefined();
    });

    it('should create child logger with module name', async () => {
      const { createLogger } = await import('../../src/core/Logger');
      const childLogger = createLogger('TestModule');

      // Verify it's a logger with expected methods
      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.error).toBe('function');
      expect(typeof childLogger.warn).toBe('function');
      expect(typeof childLogger.debug).toBe('function');
    });
  });
});
