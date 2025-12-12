/**
 * Health check types
 */

/**
 * Overall health status of the application
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

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
