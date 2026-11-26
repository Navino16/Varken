import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, RawAxiosRequestHeaders } from 'axios';
import axios from 'axios';
import * as https from 'node:https';
import { createHash } from 'node:crypto';
import { createLogger, withContext } from '../../core/Logger';
import { formatHelpfulError } from '../../utils/errors';
import { RequestCache } from '../../utils/RequestCache';
import type { GlobalConfig } from '../../config/schemas/config.schema';
import type { ApiCallOptions, ApiClient } from '../../types/api-contract';
import { expandPathTemplate } from '../../utils/pathTemplate';
import { responseStatus, serializeQuery } from '../../utils/http';
import { getEventStateStore, type EventMark } from '../../utils/EventStateStore';
import type { Bucket } from './utils/buckets';
import type {
  InputPlugin,
  PluginMetadata,
  DataPoint,
  PointSpec,
  ScheduleConfig,
} from '../../types/plugin.types';

/**
 * Base configuration interface for input plugins
 */
export interface BaseInputConfig {
  id: number;
  url: string;
  /** API key / token — optional because some services (Plex) use a different field (`token`). */
  apiKey?: string;
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

const BUCKET_GRACE_MS: number = 24 * 60 * 60 * 1000;

/**
 * Interface for paginated API responses
 */
export interface PaginatedResponse<T> {
  page?: number;
  pageSize?: number;
  totalRecords?: number;
  records?: T[] | null;
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
  private static readonly HTTP_CACHE_MAX_SIZE = 500;
  private httpCache!: RequestCache<unknown>;
  private startedAt = new Date();

  /**
   * Plugin metadata - must be implemented by subclasses
   */
  abstract readonly metadata: PluginMetadata;

  /**
   * Initialize the plugin with configuration
   */
  async initialize(config: TConfig, globalConfig?: GlobalConfig): Promise<void> {
    this.config = config;
    this.startedAt = new Date();
    if (globalConfig) {
      this.globalConfig = globalConfig;
    }
    // Tag every log record from this instance with its pluginId so aggregators
    // can filter per-instance without parsing the message string.
    this.logger = withContext(this.logger, { pluginId: this.config.id });
    this.httpClient = this.createHttpClient();
    const ttlMs = (this.globalConfig.cacheTtlSeconds ?? 0) * 1000;
    this.httpCache = new RequestCache<unknown>({
      ttlMs,
      maxSize: BaseInputPlugin.HTTP_CACHE_MAX_SIZE,
    });
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
      paramsSerializer: { serialize: serializeQuery },
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

    const client = axios.create(axiosConfig);

    client.interceptors.response.use((response: AxiosResponse) => {
      this.validateResponseData(response);
      return response;
    });

    return client;
  }

  /**
   * Validate that an API response contains JSON data, not HTML or empty content.
   * Throws if the response data is unexpected (e.g. login page, wrong URL, auth redirect).
   */
  protected validateResponseData(response: AxiosResponse): void {
    const { data } = response;
    const url = response.config?.url ?? 'unknown';

    if (data === null || data === undefined) {
      this.logger.warn(`API response from ${url} returned no data`);
      throw new Error(`Expected JSON data but received nothing from ${url}`);
    }

    if (typeof data === 'string') {
      const lower = data.toLowerCase();
      if (lower.includes('<!doctype') || lower.includes('<html')) {
        this.logger.warn(`API response from ${url} returned HTML instead of JSON — check the URL or authentication`);
        throw new Error(`Expected JSON but received HTML from ${url}`);
      }
      this.logger.warn(`API response from ${url} returned a plain string instead of JSON`);
      throw new Error(`Expected JSON but received string from ${url}`);
    }
  }

  /**
   * Make an HTTP GET request
   */
  protected async httpGet<T>(path: string, params?: Record<string, unknown>, headers?: Record<string, unknown>): Promise<T> {
    const key = headers ? `${this.cacheKey(path, params)}#${this.cacheKey('', headers)}` : this.cacheKey(path, params);
    return this.httpCache.getOrFetch(key, async () => {
      try {
        const response = await this.httpClient.get<T>(path, headers ? { params, headers: headers as RawAxiosRequestHeaders } : { params });
        return response.data;
      } catch (error) {
        this.logger.error(
          `HTTP GET ${path} failed: ${formatHelpfulError(error, { service: this.metadata.name, url: path })}`
        );
        throw error;
      }
    }) as Promise<T>;
  }

  /**
   * Make an HTTP POST request
   */
  protected async httpPost<T>(path: string, data?: unknown): Promise<T> {
    try {
      const response = await this.httpClient.post<T>(path, data);
      return response.data;
    } catch (error) {
      this.logger.error(
        `HTTP POST ${path} failed: ${formatHelpfulError(error, { service: this.metadata.name, url: path })}`
      );
      throw error;
    }
  }

  /**
   * Build a deterministic cache key from path + params (keys sorted so param
   * order does not matter). Each plugin instance has its own cache, so the
   * baseURL is not part of the key.
   */
  private cacheKey(path: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return path;
    }
    const sorted = Object.keys(params)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = params[k];
        return acc;
      }, {});
    return `${path}?${JSON.stringify(sorted)}`;
  }

  /**
   * Typed client bound to a service's generated `paths` (src/types/generated): the compiler rejects
   * unknown endpoints, unknown or mistyped parameters and undeclared response fields.
   * `basePath` is prepended when the spec's paths are relative to one (Swagger `basePath`).
   */
  protected api<Paths>(basePath = ''): ApiClient<Paths> {
    return {
      get: (path: string, options?: ApiCallOptions) =>
        this.httpGet(basePath + expandPathTemplate(path, options?.path), options?.query, options?.header),
      getAllPages: (path: string, options?: ApiCallOptions) =>
        this.fetchAllPages(basePath + expandPathTemplate(path, options?.path), options?.query, options?.header),
    } as unknown as ApiClient<Paths>;
  }

  /**
   * Fetch all pages from a paginated API endpoint.
   * Includes safety limit to prevent memory issues with large datasets.
   */
  protected async fetchAllPages<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    headers?: Record<string, unknown>
  ): Promise<T[]> {
    const allRecords: T[] = [];
    let page = 1;
    let totalRecords = 0;
    const pageSize = this.globalConfig.paginationPageSize;
    const maxRecords = this.globalConfig.maxPaginationRecords;

    do {
      const response = await this.httpGet<PaginatedResponse<T>>(
        endpoint,
        { ...params, pageSize, page },
        headers
      );

      totalRecords = response.totalRecords ?? 0;
      allRecords.push(...(response.records ?? []));
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
    timestamp?: Date,
    floatFields?: readonly string[]
  ): DataPoint {
    return {
      measurement,
      tags,
      fields,
      ...(floatFields ? { floatFields } : {}),
      timestamp: timestamp || new Date(),
    };
  }

  /** Points under the plugin measurement, tagged with this instance's `server` id. */
  protected createPoints(specs: readonly PointSpec[]): DataPoint[] {
    return specs.map((spec) =>
      this.createDataPoint(this.metadata.name, { ...spec.tags, server: this.config.id }, spec.fields, spec.timestamp, spec.floatFields)
    );
  }

  /**
   * Point of the `serverInfo` collector: version and state of the monitored service.
   * `reachable` keeps the point (and its version tags) when the service reports no other field.
   */
  protected createServerInfoPoint(tags: Record<string, string | number>, fields: Record<string, number>): DataPoint {
    return this.createDataPoint(this.metadata.name, { type: 'ServerInfo', server: this.config.id, ...tags }, { reachable: 1, ...fields });
  }

  /** Time to ask an event endpoint for events since: the collector's mark, or plugin start when it has none. */
  protected async eventCursor(collector: string): Promise<Date> {
    return new Date((await this.eventMark(collector)).time);
  }

  /**
   * Events newer than the collector's high-water mark; advances and persists the mark.
   * Events at exactly the mark time are told apart by id, since `since` endpoints are inclusive.
   */
  protected async takeNewEvents<T>(
    collector: string,
    events: readonly T[],
    timeOf: (e: T) => number,
    idOf: (e: T) => string
  ): Promise<T[]> {
    const store = getEventStateStore();
    const key = this.eventKey(collector);
    const stored = await store.get(key);
    const mark = stored ?? { time: this.startedAt.getTime(), ids: [] };
    const fresh = events.filter((e) => {
      const time = timeOf(e);
      return Number.isFinite(time) && (time > mark.time || (time === mark.time && !mark.ids.includes(idOf(e))));
    });
    if (fresh.length === 0) {
      if (!stored) {
        await store.set(key, mark);
      }
      return [];
    }
    const newest = fresh.reduce((max, e) => Math.max(max, timeOf(e)), Number.NEGATIVE_INFINITY);
    const ids = fresh.filter((e) => timeOf(e) === newest).map(idOf);
    await store.set(key, { time: newest, ids: newest === mark.time ? [...mark.ids, ...ids] : ids });
    return fresh;
  }

  /**
   * Buckets not yet emitted, each once a day after it ends: events still running at midnight are recorded when
   * they stop, and the day is the service's local one (UTC-12 to UTC+14) while bucket bounds are UTC.
   */
  protected async takeSettledBuckets<T extends Bucket>(collector: string, buckets: readonly T[]): Promise<T[]> {
    const settledAt = (bucket: T): number => bucket.end + BUCKET_GRACE_MS;
    const settled = buckets.filter((bucket) => settledAt(bucket) <= Date.now());
    return this.takeNewEvents(collector, settled, settledAt, (bucket) => bucket.category);
  }

  private async eventMark(collector: string): Promise<EventMark> {
    return (await getEventStateStore().get(this.eventKey(collector))) ?? { time: this.startedAt.getTime(), ids: [] };
  }

  private eventKey(collector: string): string {
    return `${this.metadata.name}_${this.config.id}_${collector}`;
  }

  /**
   * Wrap a collector operation with standardized error logging.
   * Logs the error with operation context, then re-throws so the PluginManager's
   * circuit breaker can track the failure.
   *
   * Replaces the boilerplate try/catch + log + re-throw pattern in collectors.
   */
  protected async safeFetch<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to ${operation}: ${message}`);
      throw error;
    }
  }

  /** Result of an optional request; undefined when the service answers one of `statuses` (feature absent or not licensed). */
  protected async optionalFetch<T>(operation: string, statuses: readonly number[], fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      const status = responseStatus(error);
      if (status !== undefined && statuses.includes(status)) {
        this.logger.debug(`Skipped ${operation}: the service answered ${status}`);
        return undefined;
      }
      throw error;
    }
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
