// HTTP utilities
export {
  createHttpClient,
  formatHttpError,
  isHttpStatus,
  isClientError,
  isServerError,
  isNetworkError,
  extractResponseData,
  withTimeout,
} from './http';

// Environment validation
export { validateEnvironment } from './env';
export type { EnvValidationResult, EnvValidationOptions } from './env';

// Error explanations
export { explainError, formatHelpfulError } from './errors';
export type { ErrorContext, ExplainedError } from './errors';

// Request cache with TTL + deduplication
export { RequestCache } from './RequestCache';
export type { RequestCacheOptions } from './RequestCache';

// Re-export types
export type { HttpClientConfig, RetryConfig } from '../types/http.types';
