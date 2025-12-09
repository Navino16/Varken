import { createLogger } from '../../core/Logger';
import { OutputPlugin, PluginMetadata, DataPoint } from '../../types/plugin.types';

/**
 * Base configuration interface for output plugins
 */
export interface BaseOutputConfig {
  url: string;
  port?: number;
  ssl?: boolean;
  verifySsl?: boolean;
}

/**
 * Abstract base class for all output plugins.
 * Provides common functionality like logging and data formatting.
 */
export abstract class BaseOutputPlugin<TConfig extends BaseOutputConfig = BaseOutputConfig>
  implements OutputPlugin<TConfig>
{
  protected config!: TConfig;
  protected logger = createLogger(this.constructor.name);

  /**
   * Plugin metadata - must be implemented by subclasses
   */
  abstract readonly metadata: PluginMetadata;

  /**
   * Initialize the plugin with configuration
   */
  async initialize(config: TConfig): Promise<void> {
    this.config = config;
    this.logger.info(`Initialized ${this.metadata.name} plugin`);
  }

  /**
   * Write data points to the output - must be implemented by subclasses
   */
  abstract write(points: DataPoint[]): Promise<void>;

  /**
   * Check if the output is healthy - must be implemented by subclasses
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Shutdown the plugin
   */
  async shutdown(): Promise<void> {
    this.logger.info(`Shutting down ${this.metadata.name} plugin`);
  }

  /**
   * Get the full URL for the output
   */
  protected getBaseUrl(): string {
    const protocol = this.config.ssl ? 'https' : 'http';
    const port = this.config.port ? `:${this.config.port}` : '';

    if (this.config.url.startsWith('http')) {
      return this.config.url;
    }

    return `${protocol}://${this.config.url}${port}`;
  }

  /**
   * Convert a DataPoint to InfluxDB Line Protocol format
   * Format: measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp
   */
  protected toLineProtocol(point: DataPoint): string {
    const measurement = this.escapeLineProtocol(point.measurement, 'measurement');

    // Format tags
    const tagPairs = Object.entries(point.tags)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        const escapedKey = this.escapeLineProtocol(key, 'tag');
        const escapedValue = this.escapeLineProtocol(String(value), 'tag');
        return `${escapedKey}=${escapedValue}`;
      })
      .sort()
      .join(',');

    // Format fields
    const fieldPairs = Object.entries(point.fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const escapedKey = this.escapeLineProtocol(key, 'field');
        const formattedValue = this.formatFieldValue(value);
        return `${escapedKey}=${formattedValue}`;
      })
      .join(',');

    // Timestamp in nanoseconds
    const timestamp = point.timestamp.getTime() * 1000000;

    // Build line: measurement,tags fields timestamp
    const tags = tagPairs ? `,${tagPairs}` : '';
    return `${measurement}${tags} ${fieldPairs} ${timestamp}`;
  }

  /**
   * Escape special characters in Line Protocol
   */
  private escapeLineProtocol(
    value: string,
    type: 'measurement' | 'tag' | 'field'
  ): string {
    let escaped = value;

    // Common escapes for all types
    escaped = escaped.replace(/\\/g, '\\\\');
    escaped = escaped.replace(/ /g, '\\ ');

    if (type === 'measurement' || type === 'tag') {
      escaped = escaped.replace(/,/g, '\\,');
      escaped = escaped.replace(/=/g, '\\=');
    }

    return escaped;
  }

  /**
   * Format a field value according to Line Protocol rules
   */
  private formatFieldValue(value: string | number | boolean): string {
    if (typeof value === 'boolean') {
      return value ? 't' : 'f';
    }

    if (typeof value === 'number') {
      // Integers need 'i' suffix, floats don't
      if (Number.isInteger(value)) {
        return `${value}i`;
      }
      return String(value);
    }

    // Strings need to be quoted
    const escaped = String(value).replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  /**
   * Convert multiple DataPoints to Line Protocol, one per line
   */
  protected toLineProtocolBatch(points: DataPoint[]): string {
    return points.map((point) => this.toLineProtocol(point)).join('\n');
  }
}
