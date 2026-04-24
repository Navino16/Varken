import winston from 'winston';
import path from 'path';
import fs from 'fs';

const LOG_FOLDER = process.env.LOG_FOLDER || './logs';

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_FOLDER)) {
    fs.mkdirSync(LOG_FOLDER, { recursive: true });
  }
} catch (error) {
  console.error(`Failed to create log directory "${LOG_FOLDER}": ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

// Sensitive data patterns to filter
const SENSITIVE_PATTERNS = [
  // Key=value and key:value patterns
  /apikey[=:]\s*["']?[\w-]+["']?/gi,
  /api_key[=:]\s*["']?[\w-]+["']?/gi,
  /token[=:]\s*["']?[\w-]+["']?/gi,
  /password[=:]\s*["']?[^"'\s]+["']?/gi,
  /secret[=:]\s*["']?[\w-]+["']?/gi,

  // URL query parameters
  /[?&]apikey=[^&\s]+/gi,
  /[?&]api_key=[^&\s]+/gi,
  /[?&]token=[^&\s]+/gi,
  /[?&]access_token=[^&\s]+/gi,

  // HTTP headers
  /X-Api-Key:\s*\S+/gi,
  /Authorization:\s*Bearer\s+\S+/gi,
  /Authorization:\s*Basic\s+\S+/gi,

  // Credentials in URLs (//user:pass@host)
  /:\/\/[^:]+:[^@]+@/gi,
];

// Filter sensitive data from logs
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

// Human-readable text format for console output
const textConsoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  filterSensitiveData(),
  winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
    const modulePrefix = module ? `[${module}]` : '';
    const extraKeys = Object.keys(rest).filter(
      (k) => k !== 'level' && k !== 'timestamp' && k !== 'message' && k !== 'module'
    );
    const extras = extraKeys.length > 0
      ? ` ${extraKeys.map((k) => `${k}=${JSON.stringify(rest[k])}`).join(' ')}`
      : '';
    return `${timestamp} ${level} ${modulePrefix} ${message}${extras}`;
  })
);

// Structured JSON format — for production/log aggregators (ELK, Loki, Datadog)
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  filterSensitiveData(),
  winston.format.json()
);

// File output stays JSON regardless of LOG_FORMAT (always structured on disk)
const fileFormat = jsonFormat;

/**
 * Select console output format based on LOG_FORMAT env var.
 * `text` (default) = colorized human-readable | `json` = structured JSON (one record per line)
 */
function resolveConsoleFormat(): winston.Logform.Format {
  const format = (process.env.LOG_FORMAT || 'text').toLowerCase();
  return format === 'json' ? jsonFormat : textConsoleFormat;
}

// Create the main logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: resolveConsoleFormat(),
    }),
    new winston.transports.File({
      filename: path.join(LOG_FOLDER, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_FOLDER, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

/**
 * Create a child logger tagged with `module` — the default entry point for modules.
 */
export function createLogger(moduleName: string): winston.Logger {
  return logger.child({ module: moduleName });
}

/**
 * Attach additional structured context to an existing logger.
 *
 * Produces a child logger whose every record will carry the given fields.
 * Use this to tag logs with `pluginId`, `scheduler`, `requestId`, etc. without
 * manually interpolating them into the message (which breaks log aggregation).
 *
 * @example
 *   const log = createLogger('Sonarr');
 *   const instanceLog = withContext(log, { pluginId: this.config.id });
 *   instanceLog.info('Collected queue'); // → { module: 'Sonarr', pluginId: 1, message: ... }
 */
export function withContext(
  parent: winston.Logger,
  context: Record<string, unknown>
): winston.Logger {
  return parent.child(context);
}

export default logger;
