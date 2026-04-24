import fs from 'fs';
import path from 'path';

export interface EnvValidationResult {
  errors: string[];
  warnings: string[];
}

export interface EnvValidationOptions {
  env?: NodeJS.ProcessEnv;
  fsModule?: Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'accessSync' | 'constants'>;
}

const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const VALID_BOOLEAN_STRINGS = ['true', 'false'];

/**
 * Validate environment variables and directory permissions before startup.
 *
 * Errors indicate configuration that will prevent Varken from running.
 * Warnings indicate recoverable issues or deprecated usage.
 */
export function validateEnvironment(
  options: EnvValidationOptions = {}
): EnvValidationResult {
  const env = options.env ?? process.env;
  const fsMod = options.fsModule ?? fs;
  const errors: string[] = [];
  const warnings: string[] = [];

  validatePort(env.HEALTH_PORT, 'HEALTH_PORT', errors);
  validateBoolean(env.HEALTH_ENABLED, 'HEALTH_ENABLED', errors);
  validateBoolean(env.METRICS_ENABLED, 'METRICS_ENABLED', errors);
  validateBoolean(env.CONFIG_WATCH, 'CONFIG_WATCH', errors);
  validateBoolean(env.DRY_RUN, 'DRY_RUN', errors);
  validateLogLevel(env.LOG_LEVEL, errors);

  validateDirectory(env.CONFIG_FOLDER || './config', 'CONFIG_FOLDER', 'read', fsMod, errors);
  validateDirectory(env.DATA_FOLDER || './data', 'DATA_FOLDER', 'write', fsMod, errors);
  validateDirectory(env.LOG_FOLDER || './logs', 'LOG_FOLDER', 'write', fsMod, errors);

  detectLegacyVars(env, warnings);

  return { errors, warnings };
}

function validatePort(value: string | undefined, name: string, errors: string[]): void {
  if (value === undefined || value === '') {
    return;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`${name}="${value}" is not a valid TCP port (expected integer 1-65535)`);
  }
}

function validateBoolean(value: string | undefined, name: string, errors: string[]): void {
  if (value === undefined || value === '') {
    return;
  }
  if (!VALID_BOOLEAN_STRINGS.includes(value.toLowerCase())) {
    errors.push(`${name}="${value}" is not a valid boolean (expected "true" or "false")`);
  }
}

function validateLogLevel(value: string | undefined, errors: string[]): void {
  if (value === undefined || value === '') {
    return;
  }
  if (!VALID_LOG_LEVELS.includes(value.toLowerCase())) {
    errors.push(
      `LOG_LEVEL="${value}" is not a valid log level (expected one of: ${VALID_LOG_LEVELS.join(', ')})`
    );
  }
}

function validateDirectory(
  dirPath: string,
  name: string,
  mode: 'read' | 'write',
  fsMod: NonNullable<EnvValidationOptions['fsModule']>,
  errors: string[]
): void {
  const resolved = path.resolve(dirPath);

  if (!fsMod.existsSync(resolved)) {
    try {
      fsMod.mkdirSync(resolved, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${name}="${dirPath}" does not exist and could not be created: ${message}`);
      return;
    }
  }

  const accessMode = mode === 'write'
    ? fsMod.constants.R_OK | fsMod.constants.W_OK
    : fsMod.constants.R_OK;

  try {
    fsMod.accessSync(resolved, accessMode);
  } catch {
    errors.push(
      `${name}="${dirPath}" is not ${mode === 'write' ? 'writable' : 'readable'} by the current user`
    );
  }
}

function detectLegacyVars(env: NodeJS.ProcessEnv, warnings: string[]): void {
  const legacyKeys = Object.keys(env).filter((key) => key.startsWith('VRKN_'));
  if (legacyKeys.length > 0) {
    warnings.push(
      `Found ${legacyKeys.length} legacy VRKN_* environment variable(s): ${legacyKeys.join(', ')}. ` +
        'These will be migrated on first startup but should be removed afterwards — use VARKEN_* overrides instead.'
    );
  }
}
