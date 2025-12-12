import http from 'node:http';
import { createLogger } from './Logger';
import type { PluginManager } from './PluginManager';
import type {
  HealthStatus,
  HealthResponse,
  HealthPluginsResponse,
  StatusResponse,
} from '../types/health.types';

const logger = createLogger('HealthServer');

/**
 * Configuration for the health server
 */
export interface HealthServerConfig {
  port: number;
  version: string;
}

/**
 * HealthServer provides HTTP endpoints for health checks and status monitoring.
 *
 * Endpoints:
 * - GET /health - Overall health status (healthy/degraded/unhealthy)
 * - GET /health/plugins - Per-plugin health status
 * - GET /status - Detailed status with scheduler information
 */
export class HealthServer {
  private server: http.Server | null = null;
  private pluginManager: PluginManager | null = null;
  private config: HealthServerConfig;
  private startTime: Date;

  constructor(config: HealthServerConfig) {
    this.config = config;
    this.startTime = new Date();
  }

  /**
   * Set the plugin manager instance for health checks
   */
  setPluginManager(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  /**
   * Start the health server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${this.config.port} is already in use`);
        } else {
          logger.error(`Health server error: ${error.message}`);
        }
        reject(error);
      });

      this.server.listen(this.config.port, () => {
        logger.info(`Health server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the health server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        logger.info('Health server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // Set CORS and content type headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Only allow GET requests
    if (method !== 'GET') {
      this.sendError(res, 405, 'Method Not Allowed');
      return;
    }

    // Route requests
    switch (url) {
      case '/health':
        this.handleHealth(res);
        break;
      case '/health/plugins':
        this.handleHealthPlugins(res);
        break;
      case '/status':
        this.handleStatus(res);
        break;
      default:
        this.sendError(res, 404, 'Not Found');
    }
  }

  /**
   * GET /health - Overall health status
   */
  private async handleHealth(res: http.ServerResponse): Promise<void> {
    try {
      const status = await this.calculateOverallStatus();
      const response: HealthResponse = {
        status,
        version: this.config.version,
        uptime: this.getUptimeSeconds(),
        timestamp: new Date(),
      };

      const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
      this.sendJson(res, statusCode, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Health check failed: ${message}`);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * GET /health/plugins - Per-plugin health status
   */
  private async handleHealthPlugins(res: http.ServerResponse): Promise<void> {
    try {
      if (!this.pluginManager) {
        this.sendError(res, 503, 'Plugin manager not initialized');
        return;
      }

      const inputStatuses = await this.pluginManager.getInputPluginStatuses();
      const outputStatuses = await this.pluginManager.getOutputPluginStatuses();
      const status = await this.calculateOverallStatus();

      const response: HealthPluginsResponse = {
        status,
        inputs: inputStatuses,
        outputs: outputStatuses,
      };

      const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
      this.sendJson(res, statusCode, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Health plugins check failed: ${message}`);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * GET /status - Detailed status with scheduler information
   */
  private async handleStatus(res: http.ServerResponse): Promise<void> {
    try {
      if (!this.pluginManager) {
        this.sendError(res, 503, 'Plugin manager not initialized');
        return;
      }

      const stats = this.pluginManager.getStats();
      const schedulers = this.pluginManager.getSchedulerStatuses();
      const status = await this.calculateOverallStatus();

      const response: StatusResponse = {
        status,
        version: this.config.version,
        uptime: this.getUptimeSeconds(),
        timestamp: new Date(),
        stats: {
          activeInputPlugins: stats.activeInputPlugins,
          activeOutputPlugins: stats.activeOutputPlugins,
          activeSchedulers: stats.activeSchedulers,
        },
        schedulers,
      };

      this.sendJson(res, 200, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Status check failed: ${message}`);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * Calculate overall health status based on plugin states
   */
  private async calculateOverallStatus(): Promise<HealthStatus> {
    if (!this.pluginManager) {
      return 'unhealthy';
    }

    const outputHealthResults = await this.pluginManager.healthCheck();
    const inputStatuses = await this.pluginManager.getInputPluginStatuses();
    const schedulerStatuses = this.pluginManager.getSchedulerStatuses();

    const outputHealthValues = Array.from(outputHealthResults.values());
    const inputHealthValues = inputStatuses.map((s) => s.healthy);

    // No outputs configured = unhealthy
    if (outputHealthValues.length === 0) {
      return 'unhealthy';
    }

    // Check if all/some outputs are healthy
    const outputsHealthy = outputHealthValues.every((h) => h);
    const someOutputsHealthy = outputHealthValues.some((h) => h);

    // Check if all/some inputs are healthy
    const inputsHealthy = inputHealthValues.length === 0 || inputHealthValues.every((h) => h);
    const someInputsHealthy = inputHealthValues.length === 0 || inputHealthValues.some((h) => h);

    // Check if any scheduler has consecutive errors (3+ = failing)
    const schedulersHealthy = schedulerStatuses.length === 0 ||
      schedulerStatuses.every((s) => s.consecutiveErrors < 3);
    const someSchedulersHealthy = schedulerStatuses.length === 0 ||
      schedulerStatuses.some((s) => s.consecutiveErrors < 3);

    if (outputsHealthy && inputsHealthy && schedulersHealthy) {
      return 'healthy';
    }

    if (someOutputsHealthy && (someInputsHealthy || someSchedulersHealthy)) {
      return 'degraded';
    }

    return 'unhealthy';
  }

  /**
   * Get uptime in seconds
   */
  private getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }

  /**
   * Send JSON response
   */
  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    res.statusCode = statusCode;
    res.end(JSON.stringify({ error: message }));
  }
}
