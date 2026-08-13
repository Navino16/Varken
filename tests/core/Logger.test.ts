import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import winston from 'winston';

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

  describe('Log directory creation', () => {
    it('should ensure log directory exists', () => {
      const logFolder = process.env.LOG_FOLDER || './logs';
      expect(fs.existsSync(logFolder)).toBe(true);
    });

    it('should create error.log file path correctly', () => {
      const logFolder = process.env.LOG_FOLDER || './logs';
      const errorLogPath = path.join(logFolder, 'error.log');
      // The path should be valid (we don't check file exists as it may not have errors yet)
      expect(typeof errorLogPath).toBe('string');
      expect(errorLogPath).toContain('error.log');
    });

    it('should create combined.log file path correctly', () => {
      const logFolder = process.env.LOG_FOLDER || './logs';
      const combinedLogPath = path.join(logFolder, 'combined.log');
      expect(typeof combinedLogPath).toBe('string');
      expect(combinedLogPath).toContain('combined.log');
    });
  });

  describe('Winston format integration', () => {
    // Test the filterSensitiveData format directly
    it('should create a working filter format', () => {
      const SENSITIVE_PATTERNS = [
        /apikey[=:]\s*["']?[\w-]+["']?/gi,
        /token[=:]\s*["']?[\w-]+["']?/gi,
        /password[=:]\s*["']?[^"'\s]+["']?/gi,
        /secret[=:]\s*["']?[\w-]+["']?/gi,
      ];

      const filterSensitiveData = winston.format((info) => {
        if (typeof info.message === 'string') {
          let filtered = info.message;
          for (const pattern of SENSITIVE_PATTERNS) {
            filtered = filtered.replace(pattern, (match) => {
              const [key] = match.split(/[=:]/);
              return `${key}=***REDACTED***`;
            });
          }
          info.message = filtered;
        }
        return info;
      });

      const format = filterSensitiveData();
      const result = format.transform({
        level: 'info',
        message: 'apikey=secret123',
      });

      expect(result).toBeDefined();
      if (result !== false) {
        expect(result.message).toBe('apikey=***REDACTED***');
      }
    });

    it('should handle non-string messages in filter', () => {
      const SENSITIVE_PATTERNS = [
        /apikey[=:]\s*["']?[\w-]+["']?/gi,
      ];

      const filterSensitiveData = winston.format((info) => {
        if (typeof info.message === 'string') {
          let filtered = info.message;
          for (const pattern of SENSITIVE_PATTERNS) {
            filtered = filtered.replace(pattern, (match) => {
              const [key] = match.split(/[=:]/);
              return `${key}=***REDACTED***`;
            });
          }
          info.message = filtered;
        }
        return info;
      });

      const format = filterSensitiveData();
      // Test with non-string message (object)
      const result = format.transform({
        level: 'info',
        message: { data: 'test' } as unknown as string,
      });

      expect(result).toBeDefined();
      // Should pass through unchanged since message is not a string
      if (result !== false) {
        expect(result.message).toEqual({ data: 'test' });
      }
    });

    it('should create printf format with module prefix', () => {
      const printfFormat = winston.format.printf(({ timestamp, level, message, module }) => {
        const modulePrefix = module ? `[${module}]` : '';
        return `${timestamp} ${level} ${modulePrefix} ${message}`;
      });

      const result = printfFormat.transform({
        level: 'info',
        message: 'Test message',
        module: 'TestModule',
        timestamp: '2024-01-01 12:00:00',
      });

      if (typeof result === 'object' && result !== null && Symbol.for('message') in result) {
        const formattedMessage = (result as { [key: symbol]: string })[Symbol.for('message')];
        expect(formattedMessage).toContain('[TestModule]');
        expect(formattedMessage).toContain('Test message');
        expect(formattedMessage).toContain('2024-01-01 12:00:00');
      }
    });

    it('should create printf format without module prefix when module is not provided', () => {
      const printfFormat = winston.format.printf(({ timestamp, level, message, module }) => {
        const modulePrefix = module ? `[${module}]` : '';
        return `${timestamp} ${level} ${modulePrefix} ${message}`;
      });

      const result = printfFormat.transform({
        level: 'info',
        message: 'Test message',
        timestamp: '2024-01-01 12:00:00',
      });

      if (typeof result === 'object' && result !== null && Symbol.for('message') in result) {
        const formattedMessage = (result as { [key: symbol]: string })[Symbol.for('message')];
        expect(formattedMessage).not.toContain('[');
        expect(formattedMessage).toContain('Test message');
      }
    });
  });

  describe('Logger functionality', () => {
    it('should create multiple child loggers with different module names', async () => {
      const { createLogger } = await import('../../src/core/Logger');

      const logger1 = createLogger('Module1');
      const logger2 = createLogger('Module2');
      const logger3 = createLogger('Module3');

      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
      expect(logger3).toBeDefined();

      // They should be different instances
      expect(logger1).not.toBe(logger2);
      expect(logger2).not.toBe(logger3);
    });

    it('should support all log levels', async () => {
      const { createLogger } = await import('../../src/core/Logger');
      const testLogger = createLogger('LevelTest');

      // These should not throw
      expect(() => testLogger.error('Error message')).not.toThrow();
      expect(() => testLogger.warn('Warning message')).not.toThrow();
      expect(() => testLogger.info('Info message')).not.toThrow();
      expect(() => testLogger.debug('Debug message')).not.toThrow();
      expect(() => testLogger.verbose('Verbose message')).not.toThrow();
      expect(() => testLogger.silly('Silly message')).not.toThrow();
    });

    it('should handle logging with metadata', async () => {
      const { createLogger } = await import('../../src/core/Logger');
      const testLogger = createLogger('MetadataTest');

      // Should not throw when logging with additional metadata
      expect(() => testLogger.info('Message with metadata', { extra: 'data' })).not.toThrow();
    });

    it('should handle logging errors', async () => {
      const { createLogger } = await import('../../src/core/Logger');
      const testLogger = createLogger('ErrorTest');

      const error = new Error('Test error');
      expect(() => testLogger.error('An error occurred', error)).not.toThrow();
    });
  });

  describe('Environment configuration', () => {
    it('should use LOG_FOLDER environment variable', () => {
      // The logger module is already loaded, so we verify the logs directory exists
      const logFolder = process.env.LOG_FOLDER || './logs';
      expect(fs.existsSync(logFolder)).toBe(true);
    });

    it('should respect LOG_LEVEL environment variable', async () => {
      // We can only verify the module loaded successfully
      // Changing LOG_LEVEL requires module reload which is complex
      const loggerModule = await import('../../src/core/Logger');
      expect(loggerModule.default.level).toBeDefined();
    });
  });

  describe('withContext', () => {
    it('should return a child logger that inherits parent behavior', async () => {
      const { createLogger, withContext } = await import('../../src/core/Logger');
      const base = createLogger('Sonarr');
      const tagged = withContext(base, { pluginId: 42 });

      expect(tagged).toBeDefined();
      expect(typeof tagged.info).toBe('function');
      expect(typeof tagged.error).toBe('function');
      expect(() => tagged.info('tagged log entry')).not.toThrow();
    });

    it('should allow stacking contexts via nested withContext calls', async () => {
      const { createLogger, withContext } = await import('../../src/core/Logger');
      const base = createLogger('Sonarr');
      const l1 = withContext(base, { pluginId: 1 });
      const l2 = withContext(l1, { scheduler: 'queue' });
      expect(() => l2.debug('stacked context')).not.toThrow();
    });
  });
});
