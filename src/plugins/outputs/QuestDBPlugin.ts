import type { AxiosInstance } from 'axios';
import type { z } from 'zod';
import { BaseOutputPlugin } from './BaseOutputPlugin';
import type { DataPoint, PluginMetadata } from '../../types/plugin.types';
import type { QuestDBConfigSchema } from '../../config/schemas/config.schema';
import { createHttpClient, withTimeout } from '../../utils/http';
import { formatHelpfulError } from '../../utils/errors';

export type QuestDBConfig = z.infer<typeof QuestDBConfigSchema>;

/**
 * QuestDB output plugin.
 *
 * Writes data points as InfluxDB line protocol to QuestDB's HTTP ILP endpoint
 * (`POST /write`). Health is probed via the `/exec` SQL endpoint so we catch
 * DNS, port, and REST-layer failures rather than just a static page response.
 *
 * Default port matches QuestDB's HTTP server (9000). For the faster native
 * TCP ILP (port 9009) a dedicated transport would be needed; HTTP is a good
 * default and reuses the existing axios plumbing.
 */
export class QuestDBPlugin extends BaseOutputPlugin<QuestDBConfig> {
  readonly metadata: PluginMetadata = {
    name: 'QuestDB',
    version: '1.0.0',
    description: 'QuestDB output plugin using InfluxDB line protocol over HTTP',
  };

  private client!: AxiosInstance;

  async initialize(config: QuestDBConfig): Promise<void> {
    await super.initialize(config);

    const baseURL = this.getBaseUrl();

    this.client = createHttpClient({
      baseURL,
      verifySsl: this.config.verifySsl,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    this.logger.info(`Connected to QuestDB at ${baseURL}`);
  }

  async write(points: DataPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    const body = this.toLineProtocolBatch(points);

    try {
      await withTimeout(
        this.client.post('/write', body),
        30000,
        'QuestDB write timed out after 30000ms'
      );
      this.logger.debug(`Wrote ${points.length} points to QuestDB`);
    } catch (error) {
      this.logger.error(
        `Failed to write to QuestDB: ${formatHelpfulError(error, { service: 'QuestDB', url: this.getBaseUrl() })}`
      );
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/exec', {
        params: { query: 'SELECT 1' },
      });
      return response.status === 200;
    } catch (error) {
      this.logger.debug(
        `QuestDB health check failed: ${formatHelpfulError(error, { service: 'QuestDB', url: this.getBaseUrl() })}`
      );
      return false;
    }
  }
}
