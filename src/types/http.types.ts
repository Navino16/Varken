/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  baseURL: string;
  timeout?: number;
  verifySsl?: boolean;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
  retryOn?: number[];
}

/**
 * Retry configuration for HTTP requests
 */
export interface RetryConfig {
  retries: number;
  retryDelay: number;
  retryOn: number[];
}
