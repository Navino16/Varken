import { InfluxDB, WriteApi, Point, HttpError } from '@influxdata/influxdb-client';
import { HealthAPI } from '@influxdata/influxdb-client-apis';
import { BaseOutputPlugin } from './BaseOutputPlugin';
import { DataPoint, PluginMetadata } from '../../types/plugin.types';
import { z } from 'zod';
import { InfluxDB2ConfigSchema } from '../../config/schemas/config.schema';

export type InfluxDB2Config = z.infer<typeof InfluxDB2ConfigSchema>;

/**
 * InfluxDB 2.x output plugin
 * Uses the official InfluxDB 2.x client with token authentication
 */
export class InfluxDB2Plugin extends BaseOutputPlugin<InfluxDB2Config> {
  readonly metadata: PluginMetadata = {
    name: 'InfluxDB2',
    version: '1.0.0',
    description: 'InfluxDB 2.x output plugin using Flux API',
  };

  private client!: InfluxDB;
  private writeApi!: WriteApi;

  /**
   * Initialize the InfluxDB 2.x client
   */
  async initialize(config: InfluxDB2Config): Promise<void> {
    await super.initialize(config);

    const url = this.getBaseUrl();

    // Create InfluxDB client
    this.client = new InfluxDB({
      url,
      token: this.config.token,
      transportOptions: {
        rejectUnauthorized: this.config.verifySsl,
      },
    });

    // Create write API with default tags
    this.writeApi = this.client.getWriteApi(
      this.config.org,
      this.config.bucket,
      'ns' // nanosecond precision
    );

    // Set default flush settings
    this.writeApi.useDefaultTags({});

    this.logger.info(
      `Connected to InfluxDB 2.x at ${url} (org: ${this.config.org}, bucket: ${this.config.bucket})`
    );
  }

  /**
   * Write data points to InfluxDB
   */
  async write(points: DataPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    try {
      for (const dataPoint of points) {
        const point = this.convertToInfluxPoint(dataPoint);
        this.writeApi.writePoint(point);
      }

      // Flush immediately to ensure data is written
      await this.writeApi.flush();
      this.logger.debug(`Wrote ${points.length} points to InfluxDB 2.x`);
    } catch (error) {
      if (error instanceof HttpError) {
        this.logger.error(
          `Failed to write to InfluxDB 2.x: ${error.statusCode} - ${error.message}`
        );
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to write to InfluxDB 2.x: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Convert a DataPoint to InfluxDB 2.x Point format
   */
  private convertToInfluxPoint(dataPoint: DataPoint): Point {
    const point = new Point(dataPoint.measurement);

    // Add tags
    for (const [key, value] of Object.entries(dataPoint.tags)) {
      point.tag(key, String(value));
    }

    // Add fields
    for (const [key, value] of Object.entries(dataPoint.fields)) {
      if (typeof value === 'boolean') {
        point.booleanField(key, value);
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          point.intField(key, value);
        } else {
          point.floatField(key, value);
        }
      } else {
        point.stringField(key, String(value));
      }
    }

    // Set timestamp
    point.timestamp(dataPoint.timestamp);

    return point;
  }

  /**
   * Check if InfluxDB is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const healthApi = new HealthAPI(this.client);
      const health = await healthApi.getHealth();
      return health.status === 'pass';
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the plugin - flush and close write API
   */
  async shutdown(): Promise<void> {
    this.logger.info('Flushing remaining data to InfluxDB 2.x...');

    try {
      await this.writeApi.close();
      this.logger.info('InfluxDB 2.x write API closed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error closing InfluxDB 2.x write API: ${message}`);
    }

    await super.shutdown();
  }
}
