import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import * as https from 'https';
import { createLogger } from '../../core/Logger';
import type {
  InputPlugin,
  PluginMetadata,
  DataPoint,
  ScheduleConfig,
} from '../../types/plugin.types';

/**
 * Base configuration interface for input plugins
 */
export interface BaseInputConfig {
  id: number;
  url: string;
  apiKey: string;
  ssl?: boolean;
  verifySsl?: boolean;
}

/**
 * Abstract base class for all input plugins.
 * Provides common functionality like HTTP client, logging, and data point creation.
 */
export abstract class BaseInputPlugin<TConfig extends BaseInputConfig = BaseInputConfig>
  implements InputPlugin<TConfig>
{
  protected config!: TConfig;
  protected httpClient!: AxiosInstance;
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
    this.httpClient = this.createHttpClient();
    this.logger.info(`Initialized ${this.metadata.name} plugin (id: ${this.config.id})`);
  }

  /**
   * Collect data from the source - must be implemented by subclasses
   */
  abstract collect(): Promise<DataPoint[]>;

  /**
   * Get schedule configurations - must be implemented by subclasses
   */
  abstract getSchedules(): ScheduleConfig[];

  /**
   * Check if the service is healthy/reachable.
   * Subclasses should override getHealthEndpoint() to specify the endpoint.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const endpoint = this.getHealthEndpoint();
      await this.httpClient.get(endpoint, { timeout: 5000 });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Health check failed for ${this.metadata.name} (id: ${this.config.id}): ${message}`);
      return false;
    }
  }

  /**
   * Get the health check endpoint path.
   * Subclasses should override this to return the appropriate endpoint.
   */
  protected getHealthEndpoint(): string {
    return '/';
  }

  /**
   * Shutdown the plugin
   */
  async shutdown(): Promise<void> {
    this.logger.info(`Shutting down ${this.metadata.name} plugin (id: ${this.config.id})`);
  }

  /**
   * Create an Axios HTTP client configured for this plugin
   */
  protected createHttpClient(): AxiosInstance {
    const protocol = this.config.ssl ? 'https' : 'http';
    const baseURL = this.config.url.startsWith('http')
      ? this.config.url
      : `${protocol}://${this.config.url}`;

    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    // Handle SSL verification
    if (this.config.ssl && !this.config.verifySsl) {
      axiosConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    return axios.create(axiosConfig);
  }

  /**
   * Make an HTTP GET request
   */
  protected async httpGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const response = await this.httpClient.get<T>(path, { params });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HTTP GET ${path} failed: ${message}`);
      throw error;
    }
  }

  /**
   * Make an HTTP POST request
   */
  protected async httpPost<T>(path: string, data?: unknown): Promise<T> {
    try {
      const response = await this.httpClient.post<T>(path, data);
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HTTP POST ${path} failed: ${message}`);
      throw error;
    }
  }

  /**
   * Create a DataPoint with the current timestamp
   */
  protected createDataPoint(
    measurement: string,
    tags: Record<string, string | number>,
    fields: Record<string, string | number | boolean>
  ): DataPoint {
    return {
      measurement,
      tags: {
        server_id: this.config.id,
        ...tags,
      },
      fields,
      timestamp: new Date(),
    };
  }

  /**
   * Helper to create a schedule config
   */
  protected createSchedule(
    name: string,
    intervalSeconds: number,
    enabled: boolean,
    collector: () => Promise<DataPoint[]>
  ): ScheduleConfig {
    return {
      name: `${this.metadata.name}_${this.config.id}_${name}`,
      intervalSeconds,
      enabled,
      collector: collector.bind(this),
    };
  }
}
