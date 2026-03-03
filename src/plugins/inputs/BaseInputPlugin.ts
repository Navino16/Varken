import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import * as https from 'https';
import { createHash } from 'crypto';
import { createLogger } from '../../core/Logger';
import type { GlobalConfig } from '../../config/schemas/config.schema';
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
  verifySsl?: boolean;
}

/**
 * Default global configuration values
 */
const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  httpTimeoutMs: 30000,
  healthCheckTimeoutMs: 5000,
  collectorTimeoutMs: 60000,
  paginationPageSize: 250,
  maxPaginationRecords: 10000,
};

/**
 * Interface for paginated API responses
 */
export interface PaginatedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

/**
 * Abstract base class for all input plugins.
 * Provides common functionality like HTTP client, logging, and data point creation.
 */
export abstract class BaseInputPlugin<TConfig extends BaseInputConfig = BaseInputConfig>
  implements InputPlugin<TConfig>
{
  protected config!: TConfig;
  protected globalConfig: GlobalConfig = DEFAULT_GLOBAL_CONFIG;
  protected httpClient!: AxiosInstance;
  protected logger = createLogger(this.constructor.name);

  /**
   * Plugin metadata - must be implemented by subclasses
   */
  abstract readonly metadata: PluginMetadata;

  /**
   * Initialize the plugin with configuration
   */
  async initialize(config: TConfig, globalConfig?: GlobalConfig): Promise<void> {
    this.config = config;
    if (globalConfig) {
      this.globalConfig = globalConfig;
    }
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
      await this.httpClient.get(endpoint, { timeout: this.globalConfig.healthCheckTimeoutMs });
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
    const baseURL = this.config.url;
    const isHttps = baseURL.startsWith('https');

    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout: this.globalConfig.httpTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    // Handle SSL verification
    if (isHttps && !this.config.verifySsl) {
      this.logger.warn(
        `SSL verification disabled for ${baseURL}. ` +
          'This exposes connections to MITM attacks. Do not use in production!'
      );
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
   * Fetch all pages from a paginated API endpoint.
   * Includes safety limit to prevent memory issues with large datasets.
   */
  protected async fetchAllPages<T>(
    endpoint: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const allRecords: T[] = [];
    let page = 1;
    let totalRecords = 0;
    const pageSize = this.globalConfig.paginationPageSize;
    const maxRecords = this.globalConfig.maxPaginationRecords;

    do {
      const response = await this.httpGet<PaginatedResponse<T>>(endpoint, {
        ...params,
        pageSize,
        page,
      });

      totalRecords = response.totalRecords;
      allRecords.push(...response.records);
      page++;

      if (allRecords.length >= maxRecords) {
        this.logger.warn(
          `Reached max pagination limit (${maxRecords}). ` +
          `Total records: ${totalRecords}. Some data may be missing.`
        );
        break;
      }
    } while (allRecords.length < totalRecords);

    return allRecords;
  }

  /**
   * Create a DataPoint with optional custom timestamp
   */
  protected createDataPoint(
    measurement: string,
    tags: Record<string, string | number>,
    fields: Record<string, string | number | boolean>,
    timestamp?: Date
  ): DataPoint {
    return {
      measurement,
      tags,
      fields,
      timestamp: timestamp || new Date(),
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

  /**
   * Generate MD5 hash for deterministic unique IDs (matching legacy behavior)
   */
  protected hashit(input: string): string {
    return createHash('md5').update(input).digest('hex');
  }
}
