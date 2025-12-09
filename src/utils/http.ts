import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import https from 'https';
import { createLogger } from '../core/Logger';
import { HttpClientConfig, RetryConfig } from '../types/http.types';

const logger = createLogger('HTTP');

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  retries: 3,
  retryDelay: 1000,
  retryOn: [408, 429, 500, 502, 503, 504],
};

/**
 * Create an HTTP client with retry logic and error handling
 */
export function createHttpClient(config: HttpClientConfig): AxiosInstance {
  const retryConfig: RetryConfig = {
    retries: config.retries ?? DEFAULT_RETRY_CONFIG.retries,
    retryDelay: config.retryDelay ?? DEFAULT_RETRY_CONFIG.retryDelay,
    retryOn: config.retryOn ?? DEFAULT_RETRY_CONFIG.retryOn,
  };

  const axiosConfig: AxiosRequestConfig = {
    baseURL: config.baseURL,
    timeout: config.timeout ?? 30000,
    headers: config.headers ?? {},
  };

  // Handle SSL verification
  if (config.verifySsl === false) {
    axiosConfig.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
  }

  const client = axios.create(axiosConfig);

  // Add retry interceptor
  addRetryInterceptor(client, retryConfig);

  // Add logging interceptor
  addLoggingInterceptor(client);

  return client;
}

/**
 * Add retry logic to an Axios instance
 */
function addRetryInterceptor(client: AxiosInstance, retryConfig: RetryConfig): void {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number };

      if (!config) {
        return Promise.reject(error);
      }

      // Initialize retry count
      config._retryCount = config._retryCount ?? 0;

      // Check if we should retry
      const statusCode = error.response?.status;
      const shouldRetry =
        config._retryCount < retryConfig.retries &&
        (statusCode === undefined || retryConfig.retryOn.includes(statusCode));

      if (!shouldRetry) {
        return Promise.reject(error);
      }

      config._retryCount++;

      // Calculate delay with exponential backoff
      const delay = retryConfig.retryDelay * Math.pow(2, config._retryCount - 1);

      logger.debug(
        `Retrying request to ${config.url} (attempt ${config._retryCount}/${retryConfig.retries}) after ${delay}ms`
      );

      // Wait before retrying
      await sleep(delay);

      // Retry the request
      return client.request(config);
    }
  );
}

/**
 * Add request/response logging interceptor
 */
function addLoggingInterceptor(client: AxiosInstance): void {
  // Request logging
  client.interceptors.request.use(
    (config) => {
      logger.debug(`${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      return config;
    },
    (error) => {
      logger.error(`Request error: ${error.message}`);
      return Promise.reject(error);
    }
  );

  // Response logging
  client.interceptors.response.use(
    (response) => {
      logger.debug(
        `${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`
      );
      return response;
    },
    (error: AxiosError) => {
      if (error.response) {
        logger.debug(
          `${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.response.status}`
        );
      } else if (error.request) {
        logger.debug(`${error.config?.method?.toUpperCase()} ${error.config?.url} - No response`);
      }
      return Promise.reject(error);
    }
  );
}

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format an Axios error for logging
 */
export function formatHttpError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  const axiosError = error as AxiosError;

  if (axiosError.response) {
    // Server responded with error status
    const status = axiosError.response.status;
    const statusText = axiosError.response.statusText;
    const url = axiosError.config?.url || 'unknown';
    const data = axiosError.response.data;

    let message = `HTTP ${status} ${statusText} for ${url}`;

    // Try to extract error message from response body
    if (data && typeof data === 'object') {
      const errorBody = data as Record<string, unknown>;
      if (errorBody.message) {
        message += `: ${errorBody.message}`;
      } else if (errorBody.error) {
        message += `: ${errorBody.error}`;
      }
    }

    return message;
  } else if (axiosError.request) {
    // Request made but no response received
    const url = axiosError.config?.url || 'unknown';
    if (axiosError.code === 'ECONNREFUSED') {
      return `Connection refused to ${url}`;
    } else if (axiosError.code === 'ETIMEDOUT') {
      return `Request timed out for ${url}`;
    } else if (axiosError.code === 'ENOTFOUND') {
      return `Host not found for ${url}`;
    }
    return `No response received from ${url}: ${axiosError.code || axiosError.message}`;
  }

  // Error setting up request
  return axiosError.message;
}

/**
 * Check if an error is a specific HTTP status code
 */
export function isHttpStatus(error: unknown, status: number): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  return error.response?.status === status;
}

/**
 * Check if an error is a client error (4xx)
 */
export function isClientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Check if an error is a server error (5xx)
 */
export function isServerError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  return status !== undefined && status >= 500 && status < 600;
}

/**
 * Check if an error is a network error (no response)
 */
export function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  return !error.response && !!error.request;
}

/**
 * Extract response data with type safety
 */
export function extractResponseData<T>(response: AxiosResponse<T>): T {
  return response.data;
}

/**
 * Execute a request with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}
