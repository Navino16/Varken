import winston from 'winston';
import path from 'path';
import fs from 'fs';

const LOG_FOLDER = process.env.LOG_FOLDER || './logs';

// Ensure log directory exists
if (!fs.existsSync(LOG_FOLDER)) {
  fs.mkdirSync(LOG_FOLDER, { recursive: true });
}

// Sensitive data patterns to filter
const SENSITIVE_PATTERNS = [
  /apikey[=:]\s*["']?[\w-]+["']?/gi,
  /token[=:]\s*["']?[\w-]+["']?/gi,
  /password[=:]\s*["']?[^"'\s]+["']?/gi,
  /secret[=:]\s*["']?[\w-]+["']?/gi,
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

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  filterSensitiveData(),
  winston.format.printf(({ timestamp, level, message, module }) => {
    const modulePrefix = module ? `[${module}]` : '';
    return `${timestamp} ${level} ${modulePrefix} ${message}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  filterSensitiveData(),
  winston.format.json()
);

// Create the main logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
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

// Create a child logger with module context
export function createLogger(moduleName: string): winston.Logger {
  return logger.child({ module: moduleName });
}

export default logger;
