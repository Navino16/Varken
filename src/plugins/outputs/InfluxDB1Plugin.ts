import { InfluxDB, IPoint, FieldType, ISingleHostConfig } from 'influx';
import * as https from 'https';
import { BaseOutputPlugin } from './BaseOutputPlugin';
import { DataPoint, PluginMetadata } from '../../types/plugin.types';
import { z } from 'zod';
import { InfluxDB1ConfigSchema } from '../../config/schemas/config.schema';

export type InfluxDB1Config = z.infer<typeof InfluxDB1ConfigSchema>;

/**
 * InfluxDB 1.x output plugin
 * Uses the legacy InfluxDB API with username/password authentication
 */
export class InfluxDB1Plugin extends BaseOutputPlugin<InfluxDB1Config> {
  readonly metadata: PluginMetadata = {
    name: 'InfluxDB1',
    version: '1.0.0',
    description: 'InfluxDB 1.x output plugin using legacy API',
  };

  private client!: InfluxDB;

  /**
   * Initialize the InfluxDB 1.x client
   */
  async initialize(config: unknown): Promise<void> {
    await super.initialize(config);

    const protocol = this.config.ssl ? 'https' : 'http';

    const options: ISingleHostConfig = {
      host: this.config.url,
      port: this.config.port,
      protocol: protocol as 'http' | 'https',
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
    };

    // Handle SSL verification
    if (this.config.ssl && !this.config.verifySsl) {
      options.options = {
        agent: new https.Agent({
          rejectUnauthorized: false,
        }),
      };
    }

    this.client = new InfluxDB(options);

    // Ensure database exists
    await this.ensureDatabase();

    this.logger.info(
      `Connected to InfluxDB 1.x at ${protocol}://${this.config.url}:${this.config.port}/${this.config.database}`
    );
  }

  /**
   * Ensure the database exists, create if not
   */
  private async ensureDatabase(): Promise<void> {
    try {
      const databases = await this.client.getDatabaseNames();
      if (!databases.includes(this.config.database)) {
        this.logger.info(`Creating database: ${this.config.database}`);
        await this.client.createDatabase(this.config.database);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not check/create database: ${message}`);
    }
  }

  /**
   * Write data points to InfluxDB
   */
  async write(points: DataPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    try {
      const influxPoints = points.map((point) => this.convertToInfluxPoint(point));
      await this.client.writePoints(influxPoints);
      this.logger.debug(`Wrote ${points.length} points to InfluxDB 1.x`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to write to InfluxDB 1.x: ${message}`);
      throw error;
    }
  }

  /**
   * Convert a DataPoint to InfluxDB IPoint format
   */
  private convertToInfluxPoint(point: DataPoint): IPoint {
    const fields: Record<string, { value: unknown; type: FieldType }> = {};

    for (const [key, value] of Object.entries(point.fields)) {
      if (typeof value === 'boolean') {
        fields[key] = { value, type: FieldType.BOOLEAN };
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fields[key] = { value, type: FieldType.INTEGER };
        } else {
          fields[key] = { value, type: FieldType.FLOAT };
        }
      } else {
        fields[key] = { value: String(value), type: FieldType.STRING };
      }
    }

    // Convert tags to strings
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(point.tags)) {
      tags[key] = String(value);
    }

    return {
      measurement: point.measurement,
      tags,
      fields,
      timestamp: point.timestamp,
    };
  }

  /**
   * Check if InfluxDB is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping(5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the plugin
   */
  async shutdown(): Promise<void> {
    await super.shutdown();
    // InfluxDB 1.x client doesn't require explicit cleanup
  }
}
