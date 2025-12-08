import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { createLogger } from '../core/Logger';
import { ConfigMigrator } from './ConfigMigrator';
import { VarkenConfigSchema, VarkenConfig } from './schemas/config.schema';

const logger = createLogger('ConfigLoader');

/**
 * ConfigLoader handles loading, validation, and environment variable overrides
 * for the Varken YAML configuration.
 */
export class ConfigLoader {
  private configFolder: string;

  constructor(configFolder: string) {
    this.configFolder = configFolder;
  }

  /**
   * Load configuration from YAML file with environment variable overrides
   * @returns Validated configuration object
   * @throws Error if configuration is invalid or missing
   */
  load(): VarkenConfig {
    const yamlPath = path.join(this.configFolder, 'varken.yaml');

    // Check if YAML config exists
    if (!fs.existsSync(yamlPath)) {
      this.handleMissingConfig(yamlPath);
    }

    // Parse YAML file
    logger.info(`Loading configuration from: ${yamlPath}`);
    const fileContent = fs.readFileSync(yamlPath, 'utf-8');
    let rawConfig: unknown;

    try {
      rawConfig = yaml.parse(fileContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to parse YAML configuration: ${message}`);
    }

    // Apply environment variable overrides
    rawConfig = this.applyEnvOverrides(rawConfig as Record<string, unknown>);

    // Validate with Zod schema
    const result = VarkenConfigSchema.safeParse(rawConfig);

    if (!result.success) {
      const errors = result.error.errors
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      throw new Error(`Configuration validation failed:\n${errors}`);
    }

    logger.info('Configuration loaded and validated successfully');
    this.logConfigSummary(result.data);

    return result.data;
  }

  /**
   * Handle missing YAML configuration file
   */
  private handleMissingConfig(yamlPath: string): never {
    const migrator = new ConfigMigrator(this.configFolder);

    if (migrator.needsMigration()) {
      // Migrate from legacy INI + env vars
      logger.info('No YAML configuration found. Migrating from legacy format...');
      const generatedPath = migrator.migrate();
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('MIGRATION COMPLETE');
      logger.info('='.repeat(60));
      logger.info(`Configuration has been migrated to: ${generatedPath}`);
      logger.info('Please review the generated configuration and restart Varken.');
      logger.info('='.repeat(60));
      process.exit(0);
    } else {
      // Create from template
      this.createFromTemplate(yamlPath);
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('CONFIGURATION REQUIRED');
      logger.info('='.repeat(60));
      logger.info(`A template configuration has been created at: ${yamlPath}`);
      logger.info('Please edit this file to configure your inputs and outputs.');
      logger.info('='.repeat(60));
      process.exit(0);
    }
  }

  /**
   * Create configuration file from template
   */
  private createFromTemplate(yamlPath: string): void {
    const templatePath = path.join(__dirname, '../../config/varken.example.yaml');
    const fallbackTemplatePath = path.join(this.configFolder, 'varken.example.yaml');

    let templateContent: string;

    if (fs.existsSync(templatePath)) {
      templateContent = fs.readFileSync(templatePath, 'utf-8');
    } else if (fs.existsSync(fallbackTemplatePath)) {
      templateContent = fs.readFileSync(fallbackTemplatePath, 'utf-8');
    } else {
      // Generate minimal template
      templateContent = this.generateMinimalTemplate();
    }

    // Ensure data folder exists
    if (!fs.existsSync(this.configFolder)) {
      fs.mkdirSync(this.configFolder, { recursive: true });
    }

    fs.writeFileSync(yamlPath, templateContent, 'utf-8');
  }

  /**
   * Generate minimal configuration template
   */
  private generateMinimalTemplate(): string {
    return `# Varken Configuration
# Documentation: https://github.com/Boerderij/Varken

# At least one output must be configured
outputs:
  # InfluxDB 2.x (recommended)
  influxdb2:
    url: "localhost"
    port: 8086
    token: "your-token-here"
    org: "varken"
    bucket: "varken"
    ssl: false
    verifySsl: false

# At least one input must be configured
inputs:
  # Example: Sonarr
  # sonarr:
  #   - id: 1
  #     url: "http://localhost:8989"
  #     apiKey: "your-api-key"
  #     verifySsl: false
  #     queue:
  #       enabled: true
  #       intervalSeconds: 30
`;
  }

  // Mapping of lowercase env var keys to camelCase config keys
  private static readonly KEY_MAPPINGS: Record<string, string> = {
    apikey: 'apiKey',
    verifyssl: 'verifySsl',
    fallbackip: 'fallbackIp',
    futuredays: 'futureDays',
    missingdays: 'missingDays',
    intervalseconds: 'intervalSeconds',
    intervaldays: 'intervalDays',
    licensekey: 'licenseKey',
    requestcounts: 'requestCounts',
    issuecounts: 'issueCounts',
    latestrequests: 'latestRequests',
    indexerstats: 'indexerStats',
  };

  /**
   * Apply VARKEN_* environment variable overrides to configuration
   * Format: VARKEN_SECTION_SUBSECTION_KEY (e.g., VARKEN_OUTPUTS_INFLUXDB2_URL)
   */
  private applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
    const envVars = Object.entries(process.env).filter(([key]) => key.startsWith('VARKEN_'));

    for (const [key, value] of envVars) {
      if (!value) continue;

      // Parse VARKEN_PATH_TO_KEY format
      const pathParts = key
        .substring(7) // Remove 'VARKEN_'
        .toLowerCase()
        .split('_')
        .map((part) => ConfigLoader.KEY_MAPPINGS[part] || part);

      this.setNestedValue(config, pathParts, this.parseEnvValue(value));
      logger.debug(`Applied env override: ${key}`);
    }

    return config;
  }

  /**
   * Set a nested value in an object using path parts
   */
  private setNestedValue(obj: Record<string, unknown>, pathParts: string[], value: unknown): void {
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];

      // Handle array index (e.g., sonarr_0_url)
      const arrayMatch = pathParts[i + 1]?.match(/^(\d+)$/);
      if (arrayMatch) {
        if (!current[part]) {
          current[part] = [];
        }
        const arr = current[part] as unknown[];
        const index = parseInt(arrayMatch[1], 10);
        if (!arr[index]) {
          arr[index] = {};
        }
        current = arr[index] as Record<string, unknown>;
        i++; // Skip the index part
        continue;
      }

      if (!current[part]) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const finalKey = pathParts[pathParts.length - 1];
    current[finalKey] = value;
  }

  /**
   * Parse environment variable value to appropriate type
   */
  private parseEnvValue(value: string): unknown {
    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;

    // String (default)
    return value;
  }

  /**
   * Log configuration summary (without sensitive data)
   */
  private logConfigSummary(config: VarkenConfig): void {
    logger.info('Configuration summary:');

    // Outputs
    const outputs = Object.keys(config.outputs).filter(
      (key) => config.outputs[key as keyof typeof config.outputs] !== undefined
    );
    logger.info(`  Outputs: ${outputs.join(', ') || 'none'}`);

    // Inputs
    const inputs = Object.entries(config.inputs)
      .filter(([, value]) => value && value.length > 0)
      .map(([key, value]) => `${key}(${value?.length})`);
    logger.info(`  Inputs: ${inputs.join(', ') || 'none'}`);
  }
}
