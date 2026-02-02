/**
 * Health check types
 */

/**
 * Overall health status of the application
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Circuit breaker state
 * - closed: Normal operation, requests are allowed
 * - open: Circuit is tripped, requests are blocked
 * - half-open: Testing if service has recovered
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive errors before disabling scheduler (default: 10) */
  maxConsecutiveErrors: number;
  /** Interval multiplier per failure (default: 2) */
  backoffMultiplier: number;
  /** Maximum interval cap in seconds (default: 600) */
  maxIntervalSeconds: number;
  /** Wait time before recovery attempt in seconds (default: 300) */
  cooldownSeconds: number;
  /** Number of successes needed to fully recover (default: 3) */
  recoverySuccesses: number;
}

/**
 * Public scheduler status for health checks
 */
export interface SchedulerStatus {
  name: string;
  pluginName: string;
  intervalSeconds: number;
  isRunning: boolean;
  lastRunAt?: Date;
  lastError?: string;
  consecutiveErrors: number;
  /** Circuit breaker state */
  circuitState: CircuitBreakerState;
  /** Current interval in seconds (may differ from base due to backoff) */
  currentIntervalSeconds: number;
  /** When the circuit was opened (disabled) */
  disabledAt?: Date;
  /** When the next recovery attempt will be made (circuit open) */
  nextAttemptAt?: Date;
  /** Number of successful recoveries in half-open state */
  recoverySuccesses: number;
  /** When the next scheduled run will occur */
  nextRunAt?: Date;
}

/**
 * Plugin status for health checks
 */
export interface PluginStatus {
  type: string;
  name: string;
  version: string;
  healthy: boolean;
  error?: string;
}

/**
 * Health check response for GET /health
 */
export interface HealthResponse {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: Date;
}

/**
 * Detailed health check response for GET /health/plugins
 */
export interface HealthPluginsResponse {
  status: HealthStatus;
  inputs: PluginStatus[];
  outputs: PluginStatus[];
}

/**
 * Status response for GET /status
 */
export interface StatusResponse {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: Date;
  stats: {
    activeInputPlugins: number;
    activeOutputPlugins: number;
    activeSchedulers: number;
  };
  schedulers: SchedulerStatus[];
}
