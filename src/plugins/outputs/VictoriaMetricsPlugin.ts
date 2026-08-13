import type { AxiosInstance } from 'axios';
import type { z } from 'zod';
import { BaseOutputPlugin } from './BaseOutputPlugin';
import type { DataPoint, PluginMetadata } from '../../types/plugin.types';
import type { VictoriaMetricsConfigSchema } from '../../config/schemas/config.schema';
import { createHttpClient, withTimeout } from '../../utils/http';
import { formatHelpfulError } from '../../utils/errors';

export type VictoriaMetricsConfig = z.infer<typeof VictoriaMetricsConfigSchema>;

/**
 * VictoriaMetrics output plugin
 * Writes data using InfluxDB line protocol over HTTP.
 */
export class VictoriaMetricsPlugin extends BaseOutputPlugin<VictoriaMetricsConfig> {
  readonly metadata: PluginMetadata = {
    name: 'VictoriaMetrics',
    version: '1.0.0',
    description: 'VictoriaMetrics output plugin using InfluxDB line protocol',
  };

  private client!: AxiosInstance;

  async initialize(config: VictoriaMetricsConfig): Promise<void> {
    await super.initialize(config);

    const baseURL = this.getBaseUrl();

    this.client = createHttpClient({
      baseURL,
      verifySsl: this.config.verifySsl,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    this.logger.info(`Connected to VictoriaMetrics at ${baseURL}`);
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
        'VictoriaMetrics write timed out after 30000ms'
      );
      this.logger.debug(`Wrote ${points.length} points to VictoriaMetrics`);
    } catch (error) {
      this.logger.error(`Failed to write to VictoriaMetrics: ${formatHelpfulError(error, { service: 'VictoriaMetrics', url: this.getBaseUrl() })}`);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      this.logger.debug(`VictoriaMetrics health check failed: ${formatHelpfulError(error, { service: 'VictoriaMetrics', url: this.getBaseUrl() })}`);
      return false;
    }
  }
}
